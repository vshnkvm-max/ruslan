export function createCustomerBalances(db, { fail, num }) {
  function customer(id) {
    const row = db.prepare('SELECT id,balance FROM customers WHERE id=? AND deleted=0').get(id);
    if (!row) fail(404, 'Клиент не найден.');
    return row;
  }
  function read(id) {
    const row = customer(id);
    const history = db.prepare(`SELECT b.id,b.old_balance,b.new_balance,b.amount,b.created_at,a.username AS admin_name
      FROM customer_balance_adjustments b JOIN admins a ON a.id=b.admin_id WHERE b.customer_id=? ORDER BY b.id DESC LIMIT 10`).all(id);
    return { balance: row.balance, history };
  }
  function set(id, body, adminId) {
    const balance = num(body.balance, 'Баланс', 100000000);
    if (!Number.isSafeInteger(body.expected_balance) || body.expected_balance < 0) fail(400, 'Обновите текущий баланс клиента.');
    if (typeof body.request_key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(body.request_key)) fail(400, 'Обновите форму изменения баланса.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = customer(id);
      const existing = db.prepare('SELECT * FROM customer_balance_adjustments WHERE request_key=?').get(body.request_key);
      if (existing) {
        if (existing.customer_id !== id || existing.admin_id !== adminId || existing.new_balance !== balance) fail(409, 'Этот запрос уже использован. Откройте форму заново.');
        db.exec('COMMIT');
        return { balance: row.balance, applied_balance: existing.new_balance, repeated: true };
      }
      if (row.balance !== body.expected_balance) fail(409, 'Баланс клиента изменился. Проверьте текущую сумму и повторите сохранение.');
      db.prepare('UPDATE customers SET balance=? WHERE id=?').run(balance, id);
      db.prepare('INSERT INTO customer_balance_adjustments(customer_id,admin_id,old_balance,new_balance,amount,request_key,created_at) VALUES (?,?,?,?,?,?,?)').run(id,adminId,row.balance,balance,balance-row.balance,body.request_key,new Date().toISOString());
      db.exec('COMMIT');
      return { balance, applied_balance: balance, repeated: false };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { read, set };
}
