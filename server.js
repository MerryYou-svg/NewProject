const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Database Connection Setup (PostgreSQL on Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Prevent server crash on unexpected idle client errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err);
});

// Helper function to initialize database tables automatically
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255),
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
        bundle_price NUMERIC(10, 2) NOT NULL,
        bundle_qty INT DEFAULT 12,
        stock INT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        items JSONB NOT NULL,
        total_amount NUMERIC(10, 2) NOT NULL,
        assigned_worker VARCHAR(50) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        delivery_address TEXT,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables initialized successfully.");
  } catch (err) {
    console.error("Error initializing database tables:", err);
  }
};

initDb();

// --- API ENDPOINTS ---

// Check Role Status (Owner / Worker availability)
app.get('/api/role-status', async (req, res) => {
  try {
    const ownerRes = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'Owner'");
    const w1Res = await pool.query("SELECT COUNT(*) FROM users WHERE worker_choice = 'Worker 1'");
    const w2Res = await pool.query("SELECT COUNT(*) FROM users WHERE worker_choice = 'Worker 2'");
    
    res.json({
      ownerTaken: parseInt(ownerRes.rows[0].count) > 0,
      worker1Taken: parseInt(w1Res.rows[0].count) > 0,
      worker2Taken: parseInt(w2Res.rows[0].count) > 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User Registration
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, worker_choice, delivery_address } = req.body;
  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already registered.' });
    }
    
    const newUser = await pool.query(
      `INSERT INTO users (full_name, email, password, role, worker_choice, delivery_address) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, email, role, delivery_address`,
      [full_name, email, password, role, worker_choice || null, delivery_address || null]
    );
    
    res.json({ success: true, user: newUser.rows[0], message: 'Registration successful!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database registration error: ' + err.message });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
    if (result.rows.length > 0) {
      const u = result.rows[0];
      const userPayload = {
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        role: u.worker_choice || u.role,
        delivery_address: u.delivery_address
      };
      res.json({ success: true, user: userPayload });
    } else {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database login error: ' + err.message });
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

// Add New Product
app.post('/api/products', async (req, res) => {
  const { name, price, bundle_price, bundle_qty, stock } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO products (name, price, bundle_price, bundle_qty, stock) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, price, bundle_price, bundle_qty || 12, stock]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Product / Restock
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { price, bundle_price, bundle_qty, add_stock } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products 
       SET price = $1, bundle_price = $2, bundle_qty = $3, stock = stock + $4 
       WHERE id = $5 RETURNING *`,
      [price, bundle_price, bundle_qty || 12, add_stock || 0, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Orders
app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Order
app.post('/api/orders', async (req, res) => {
  const { id, client_name, items, total_amount, assigned_worker, payment_method, delivery_address, status } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO orders (id, client_name, items, total_amount, assigned_worker, payment_method, delivery_address, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, client_name, JSON.stringify(items), total_amount, assigned_worker, payment_method, delivery_address, status || 'Pending']
    );
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Order Status (Approve & Deduct Stock / Mark Delivered)
app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (orderRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Order not found' });
    
    const order = orderRes.rows[0];
    
    // Deduct stock upon approval
    if (status === 'Approved' && order.status !== 'Approved') {
      const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
      for (let item of items) {
        const deductQty = item.qty * 12; // Bundle order deducts 12pcs
        await pool.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [deductQty, item.product_id]);
      }
    }
    
    const updated = await pool.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING *", [status, id]);
    res.json({ success: true, order: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Order History
app.delete('/api/orders/history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete All History for Specific Worker
app.delete('/api/orders/worker-history/:workerName', async (req, res) => {
  const { workerName } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE assigned_worker = $1", [workerName]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});