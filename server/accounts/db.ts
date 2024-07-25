import { Connection, GetConnection, db } from 'db';
import { OxPlayer } from 'player/class';
import type { OxAccount, OxAccountRoles } from 'types';
import locales from '../../common/locales';
import { getRandomInt } from '@overextended/ox_lib';
import { CanPerformAction } from './roles';

const addBalance = `UPDATE accounts SET balance = balance + ? WHERE id = ?`;
const removeBalance = `UPDATE accounts SET balance = balance - ? WHERE id = ?`;
const safeRemoveBalance = `${removeBalance} AND (balance - ?) >= 0`;
const addTransaction = `INSERT INTO accounts_transactions (actorId, fromId, toId, amount, message, note, fromBalance, toBalance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const getBalance = `SELECT balance FROM accounts WHERE id = ?`;
const doesAccountExist = `SELECT 1 FROM accounts WHERE id = ?`;

async function GenerateAccountId(conn: Connection) {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const baseId = Number(year + month) * 1e3;

  while (true) {
    const accountId = getRandomInt(10, 99) * 1e7 + baseId + getRandomInt(0, 9999);
    const existingId = await conn.scalar<number>(doesAccountExist, [accountId]);

    if (!existingId) return accountId;
  }
}

export async function UpdateBalance(
  id: number,
  amount: number,
  action: 'add' | 'remove',
  overdraw: boolean,
  message?: string,
  note?: string
) {
  using conn = await GetConnection();
  const balance = await conn.scalar<number>(getBalance, [id]);

  if (balance === null) return 'no_balance';

  const addAction = action === 'add';
  const success = addAction
    ? await conn.update(addBalance, [amount, id])
    : await conn.update(overdraw ? removeBalance : safeRemoveBalance, [amount, id, amount]);

  return (
    success &&
    (await conn.update(addTransaction, [
      null,
      addAction ? null : id,
      addAction ? id : null,
      amount,
      message,
      note,
      addAction ? null : balance + amount,
      addAction ? balance + amount : null,
    ])) === 1
  );
}

interface AccountTransactionStartParams
{
  accountId: number;
  amount: number;
  message?: string;
  note?: string;
  actorId?: number;
}

async function startAccountTransactionInternal<TParams extends AccountTransactionStartParams, TResult>( conn: Connection, params: TParams/*, handler: () => Promise<TResult> */ )
{
  await conn.startTransaction( async ( tx ) =>
  {
    await tx.update( addBalance, [ params.amount, params.accountId ] )

    await tx.execute( addTransaction, [
      params.actorId,
      params.accountId,
      params.accountId,
      params.amount,
      params.message ?? locales( 'transfer' ),
      params.note,
      null,
      null,
    ]);
  });
}

// #

async function startAccountTransactionRemoveBalance( conn: Connection, params: AccountTransactionStartParams )
{
  params.amount = -Math.abs( params.amount );

  await startAccountTransactionInternal( conn, params );
}

async function startAccountTransactionRemoveBalanceWithDebit( conn: Connection, params: AccountTransactionStartParams )
{
  conn.startTransaction( async ( tx ) =>
  {
    await startAccountTransactionRemoveBalance( tx, params );

    // add debit!
  });
}

async function startAccountTransactionAddBalance( conn: Connection, params: AccountTransactionStartParams )
{
  params.amount = Math.abs( params.amount );

  await startAccountTransactionInternal( conn, params );
}

// #

interface AccountOperationStartParams extends Omit<AccountTransactionStartParams, 'accountId'>
{
  paramsAccountFrom: Pick<AccountTransactionStartParams, 'accountId'>;
  paramsAccountTo  : Pick<AccountTransactionStartParams, 'accountId'>;
}

function startAccountOperation( conn: Connection, { paramsAccountFrom, paramsAccountTo, ...transactionParams }: AccountOperationStartParams )
{
  console.assert( transactionParams.amount > 0 );

  return conn.startTransaction( async ( tx ) =>
  {
    await startAccountTransactionRemoveBalance( tx, { ...transactionParams, ...paramsAccountFrom } );

    await startAccountTransactionAddBalance   ( tx, { ...transactionParams, ...paramsAccountTo   } );
  });
}

// #

RegisterCommand('operation', async () =>
{
  console.log('operation=')

  const conn = await GetConnection();

  try
  {
    await startAccountOperation( conn, {
      amount: 1000,
      message: 'Test',
      note: 'Test',
      actorId: 1,

      paramsAccountFrom: { accountId: 442411284 },
      paramsAccountTo  : { accountId: 442411284 },
    });

    // await startAccountTransactionRemoveBalance( conn, {
    //   accountId: 442411284,
    //   amount: 1000,
    //   message: 'Test',
    //   note: 'Test',
    //   actorId: 1,
    // });

    console.log( 'Operation succeded!' );
  }
  catch ( e )
  {
    console.log( e );

    console.log( 'An error occurred while performing this operation!' );
  }
}, false);

export async function PerformTransaction(
  fromId: number,
  toId: number,
  amount: number,
  overdraw: boolean,
  message?: string,
  note?: string,
  actorId?: number
) {
  using conn = await GetConnection();

  const fromBalance = await conn.scalar<number>(getBalance, [fromId]);
  const toBalance = await conn.scalar<number>(getBalance, [toId]);

  console.log('toBalance', fromBalance, toBalance)

  if (fromBalance === null || toBalance === null) return 'no_balance';

  await conn.beginTransaction();

  console.log('starting transaction')

  try {
    // const b = await conn.update(addBalance, [amount, toId]);

    await conn.update( removeBalance, [ amount, fromId ]);

    await conn.execute(addTransaction, [
      actorId,
      fromId,
      toId,
      amount,
      message ?? locales('transfer'),
      note,
      fromBalance - amount,
      toBalance + amount,
    ]);

    await conn.commit();
  }
  catch (e)
  {
    conn.rollback();

    console.log('thanks!')

    console.error(`Failed to transfer $${amount} from account<${fromId}> to account<${toId}>`);
    console.log(e);

    return false;
  }

  return true;
}

export async function SelectAccounts(column: 'owner' | 'group' | 'id', id: number | string) {
  return db.execute<OxAccount>(`SELECT * FROM accounts WHERE \`${column}\` = ?`, [id]);
}

export async function SelectDefaultAccount(column: 'owner' | 'group' | 'id', id: number | string) {
  return await db.row<OxAccount>(`SELECT * FROM accounts WHERE \`${column}\` = ? AND isDefault = 1`, [id]);
}

export async function SelectAccount(id: number) {
  return db.single(await SelectAccounts('id', id));
}

export async function SelectAllAccounts(id: number) {
  return await db.execute<OxAccount>(
    'SELECT ac.role, a.* FROM `accounts_access` ac LEFT JOIN accounts a ON a.id = ac.accountId WHERE ac.charId = ?',
    [id]
  );
}

export async function IsAccountIdAvailable(id: number) {
  return !(await db.exists(doesAccountExist, [id]));
}

export async function CreateNewAccount(
  column: 'owner' | 'group',
  id: string | number,
  label: string,
  shared?: boolean,
  isDefault?: boolean
) {
  using conn = await GetConnection();

  const accountId = await GenerateAccountId(conn);
  const result = await conn.update(
    `INSERT INTO accounts (id, label, \`${column}\`, type, isDefault) VALUES (?, ?, ?, ?, ?)`,
    [accountId, label, id, shared ? 'shared' : 'personal', isDefault || 0]
  );

  if (result && typeof id === 'number')
    conn.execute(`INSERT INTO accounts_access (accountId, charId, role) VALUE (?, ?, ?)`, [accountId, id, 'owner']);

  return accountId;
}

export function DeleteAccount(accountId: number) {
  return db.update(`UPDATE accounts SET \`type\` = 'inactive' WHERE id = ?`, [accountId]);
}

const selectAccountRole = `SELECT role FROM accounts_access WHERE accountId = ? AND charId = ?`;

export function SelectAccountRole(accountId: number, charId: number) {
  return db.column<OxAccount['role']>(selectAccountRole, [accountId, charId]);
}

export async function DepositMoney(
  playerId: number,
  accountId: number,
  amount: number,
  message?: string,
  note?: string
) {
  const player = OxPlayer.get(playerId);

  if (!player?.charId) return 'no_charId';

  const money = exports.ox_inventory.GetItemCount(playerId, 'money');

  if (amount > money) return 'insufficient_funds';

  using conn = await GetConnection();
  const balance = await conn.scalar<number>(getBalance, [accountId]);

  if (balance === null) return 'no_balance';

  const role = await conn.scalar<OxAccountRoles>(selectAccountRole, [accountId, player.charId]);

  if (!(await CanPerformAction(player, accountId, role, 'deposit'))) return 'no_access';

  await conn.beginTransaction();

  const affectedRows = await conn.update(addBalance, [amount, accountId]);

  if (!affectedRows || !exports.ox_inventory.RemoveItem(playerId, 'money', amount)) {
    conn.rollback();
    return false;
  }

  await conn.execute(addTransaction, [
    player.charId,
    null,
    accountId,
    amount,
    message ?? locales('deposit'),
    note,
    null,
    balance + amount,
  ]);

  return true;
}

export async function WithdrawMoney(
  playerId: number,
  accountId: number,
  amount: number,
  message?: string,
  note?: string
) {
  const player = OxPlayer.get(playerId);

  if (!player?.charId) return 'no_charId';

  using conn = await GetConnection();
  const role = await conn.scalar<OxAccountRoles>(selectAccountRole, [accountId, player.charId]);

  if (!CanPerformAction(player, accountId, role, 'withdraw')) return 'no_access';

  const balance = await conn.scalar<number>(getBalance, [accountId]);

  if (balance === null) return 'no_balance';

  await conn.beginTransaction();

  const affectedRows = await conn.update(safeRemoveBalance, [amount, accountId, amount]);

  if (!affectedRows || !exports.ox_inventory.AddItem(playerId, 'money', amount)) {
    conn.rollback();
    return false;
  }

  await conn.execute(addTransaction, [
    player.charId,
    accountId,
    null,
    amount,
    message ?? locales('withdraw'),
    note,
    balance - amount,
    null,
  ]);

  return true;
}

export function UpdateAccountAccess(accountId: number, id: number, role?: string) {
  if (!role) return db.update(`DELETE FROM accounts_access WHERE accountId = ? AND charId = ?`, [accountId, id]);

  return db.update(
    `INSERT INTO accounts_access (accountId, charId, role) VALUE (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [accountId, id, role]
  );
}
