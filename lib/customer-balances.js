export function createCustomerBalances(db, { fail, num, str }) {
  function customer(id) {
    const row = db.prepare('SELECT id,balance FROM customers WHERE id=? AND deleted=0').get(id);
    if (!row) fail(404, 'Клиент не найден.');
    return row;
  }
  function read(id) {
    const row = customer(id);
    const history = db.prepare(`SELECT b.id,b.old_balance,b.new_balance,b.amount,b.reason,b.created_at,a.username AS admin_name
      FROM customer_balance_adjustments b JOIN admins a ON a.id=b.admin_id WHERE b.customer_id=? ORDER BY b.id DESC LIMIT 10`).all(id);
    return { balance: row.balance, history };
  }
  function set(id, body, adminId) {
    if (!Number.isSafeInteger(body.expected_balance) || body.expected_balance < 0) fail(400, 'Обновите текущий баланс клиента.');
    if (typeof body.request_key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(body.request_key)) fail(400, 'Обновите форму изменения баланса.');
    const reason = body.reason === undefined ? '' : str(body.reason, 'Причина', 500, false);
    let balance;
    if (body.operation === undefined) {
      balance = num(body.balance, 'Баланс', 100000000);
    } else {
      if (!['credit','debit'].includes(body.operation)) fail(400, 'Выберите начисление или списание.');
      const amount = num(body.amount, 'Сумма', 100000000);
      if (!amount) fail(400, 'Введите сумму больше нуля.');
      balance = body.expected_balance + (body.operation === 'credit' ? amount : -amount);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = customer(id);
      const existing = db.prepare('SELECT * FROM customer_balance_adjustments WHERE request_key=?').get(body.request_key);
      if (existing) {
        if (existing.customer_id !== id || existing.admin_id !== adminId || existing.new_balance !== balance || existing.reason !== reason ||
            (body.operation !== undefined && existing.old_balance !== body.expected_balance)) fail(409, 'Этот запрос уже использован. Откройте форму заново.');
        db.exec('COMMIT');
        return { balance: row.balance, applied_balance: existing.new_balance, repeated: true };
      }
      if (row.balance !== body.expected_balance) fail(409, 'Баланс клиента изменился. Проверьте текущую сумму и повторите сохранение.');
      if (balance < 0) fail(400, 'На балансе клиента недостаточно рублей.');
      num(balance, 'Итоговый баланс', 100000000);
      db.prepare('UPDATE customers SET balance=? WHERE id=?').run(balance, id);
      db.prepare('INSERT INTO customer_balance_adjustments(customer_id,admin_id,old_balance,new_balance,amount,request_key,created_at,reason) VALUES (?,?,?,?,?,?,?,?)').run(id,adminId,row.balance,balance,balance-row.balance,body.request_key,new Date().toISOString(),reason);
      db.exec('COMMIT');
      return { balance, applied_balance: balance, repeated: false };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { read, set };
}
