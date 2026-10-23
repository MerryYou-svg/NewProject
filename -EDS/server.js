const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// PostgreSQL Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/your_database_name',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ==========================================
// 1. USERS API (Register & Login)
// ==========================================
app.post('/api/register', async (req, res) => {
  const { username, full_name, email, password, role, delivery_address } = req.body;
  try {
    const newUser = await pool.query(
      'INSERT INTO users (username, full_name, email, password_hash, role, delivery_address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [username || full_name, full_name, email, password, role, delivery_address]
    );
    res.json({ success: true, user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1 AND password_hash = $2', [email, password]);
    if (user.rows.length > 0) {
      res.json({ success: true, user: user.rows[0] });
    } else {
      res.status(401).json({ success: false, message: 'Sayop ang email o password!' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 2. PRODUCTS & INVENTORY API
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const products = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(products.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, category_id, supplier_id, price, stock } = req.body;
  try {
    const newProd = await pool.query(
      'INSERT INTO products (name, category_id, supplier_id, price, stock) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, category_id || null, supplier_id || null, price, stock]
    );
    res.json({ success: true, product: newProd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. ORDERS API
// ==========================================
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(orders.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const { id, client_name, client_address, total_amount, payment_method, assigned_worker, status, items } = req.body;
  try {
    await pool.query('BEGIN');
    await pool.query(
      'INSERT INTO orders (id, client_name, client_address, total_amount, payment_method, assigned_worker, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, client_name, client_address, total_amount, payment_method, assigned_worker, status || 'Pending']
    );
         
    for (let item of items) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, product_name, price_per_unit, quantity) VALUES ($1, $2, $3, $4, $5)',
        [id, item.product_id || null, item.product_name, item.price, item.quantity]
      );
    }
         
    await pool.query('COMMIT');
    res.json({ success: true, message: 'Na-save ang order!' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 4. EXPENSES API
// ==========================================
app.get('/api/expenses', async (req, res) => {
  try {
    const expenses = await pool.query('SELECT * FROM expenses ORDER BY created_at DESC');
    res.json(expenses.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  const { title, category, amount, recorded_by, expense_date, notes } = req.body;
  try {
    const newExpense = await pool.query(
      'INSERT INTO expenses (title, category, amount, recorded_by, expense_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, category, amount, recorded_by || null, expense_date || null, notes || null]
    );
    res.json({ success: true, expense: newExpense.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));