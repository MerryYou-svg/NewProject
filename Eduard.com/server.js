const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection Pool using Render's DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize Database Tables
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        worker_choice VARCHAR(50),
        delivery_address TEXT
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        bundle_price NUMERIC(10, 2),
        bundle_qty INTEGER DEFAULT 12,
        stock INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        items JSONB NOT NULL,
        total_amount NUMERIC(10, 2) NOT NULL,
        assigned_worker VARCHAR(50),
        payment_method VARCHAR(50),
        delivery_address TEXT,
        status VARCHAR(50) DEFAULT 'Pending'
      );
    `);
    console.log("Database tables initialized successfully.");
  } catch (err) {
    console.error("Error initializing database tables:", err);
  }
};

initDb();

// --- API ROUTES ---

// Temporary cleanup route para sa duplicate workers
app.get('/api/cleanup-workers', async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM users 
      WHERE id NOT IN (
        SELECT MIN(id) FROM users WHERE role = 'Worker 1' GROUP BY role
      ) AND role = 'Worker 1';
    `);
    
    await pool.query(`
      DELETE FROM users 
      WHERE id NOT IN (
        SELECT MIN(id) FROM users WHERE role = 'Worker 2' GROUP BY role
      ) AND role = 'Worker 2';
    `);
    
    res.json({ success: true, message: 'Na-cleanup na ang mga dobleng workers! Usa na lang kada role ang nabilin.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Role Status Check
app.get('/api/role-status', async (req, res) => {
  try {
    const ownerRes = await pool.query("SELECT * FROM users WHERE role = 'Owner'");
    const workerRes = await pool.query("SELECT * FROM users WHERE role LIKE 'Worker%'");
    
    let worker1Taken = false;
    let worker2Taken = false;
    
    workerRes.rows.forEach(w => {
      if (w.worker_choice === 'Worker 1' || w.role === 'Worker 1') worker1Taken = true;
      if (w.worker_choice === 'Worker 2' || w.role === 'Worker 2') worker2Taken = true;
    });
    
    res.json({
      ownerTaken: ownerRes.rows.length > 0,
      worker1Taken,
      worker2Taken
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register User (Strict 1 account max)
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, worker_choice, delivery_address } = req.body;
  try {
    if (role === 'Owner') {
      const ownerCheck = await pool.query("SELECT * FROM users WHERE role = 'Owner'");
      if (ownerCheck.rows.length > 0) {
        return res.status(400).json({ success: false, message: 'Owner account already exists!' });
      }
    }
    
    if (role === 'Worker' && worker_choice) {
      const workerCheck = await pool.query("SELECT * FROM users WHERE role = $1", [worker_choice]);
      if (workerCheck.rows.length > 0) {
        return res.status(400).json({ success: false, message: `${worker_choice} is already taken!` });
      }
    }
    
    const assignedRole = role === 'Worker' ? worker_choice : role;
    
    const newUser = await pool.query(
      `INSERT INTO users (full_name, email, password, role, worker_choice, delivery_address) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [full_name, email, password, assignedRole, worker_choice || null, delivery_address || null]
    );
    
    res.json({ success: true, message: 'Registration successful!', user: newUser.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Email already registered or invalid data.' });
  }
});

// Login User
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get All Products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Product (Owner)
app.post('/api/products', async (req, res) => {
  const { name, price, bundle_price, bundle_qty, stock } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO products (name, price, bundle_price, bundle_qty, stock) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, price, bundle_price || price * 12, bundle_qty || 12, stock]
    );
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update / Restock Product
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { price, bundle_price, add_stock } = req.body;
  try {
    const current = await pool.query("SELECT stock FROM products WHERE id = $1", [id]);
    if (current.rows.length === 0) return res.status(404).json({ success: false, message: 'Product not found' });
    
    const newStock = current.rows[0].stock + (parseInt(add_stock) || 0);
    
    const result = await pool.query(
      `UPDATE products SET price = $1, bundle_price = $2, stock = $3 WHERE id = $4 RETURNING *`,
      [price, bundle_price, newStock, id]
    );
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get All Orders
app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Order / Walk-in Sale
app.post('/api/orders', async (req, res) => {
  const { id, client_name, items, total_amount, assigned_worker, payment_method, delivery_address, status } = req.body;
  try {
    if (status === 'Delivered') {
      for (let item of items) {
        const deductQty = item.qty * 12;
        await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [deductQty, item.product_id]);
      }
    }
    
    const result = await pool.query(
      `INSERT INTO orders (id, client_name, items, total_amount, assigned_worker, payment_method, delivery_address, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, client_name, JSON.stringify(items), total_amount, assigned_worker, payment_method, delivery_address, status || 'Pending']
    );
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Order Status
app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const orderQuery = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (orderQuery.rows.length === 0) return res.status(404).json({ success: false, message: 'Order not found' });
    
    const order = orderQuery.rows[0];
    
    if (order.status === 'Pending' && status === 'Approved') {
      const items = order.items;
      for (let item of items) {
        const deductQty = item.qty * 12;
        await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [deductQty, item.product_id]);
      }
    }
    
    const result = await pool.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING *", [status, id]);
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Single Order History
app.delete('/api/orders/history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE id = $1", [id]);
    res.json({ success: true, message: 'Order history deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete All Worker History
app.delete('/api/orders/worker-history/:workerName', async (req, res) => {
  const { workerName } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE assigned_worker = $1", [decodeURIComponent(workerName)]);
    res.json({ success: true, message: 'Worker history cleared.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});