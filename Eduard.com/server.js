// API: Register User (with Worker 1 / Worker 2 limit)
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, delivery_address } = req.body;
  try {
    // Check if email exists
    const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) {
      return res.json({ success: false, message: 'Email already registered!' });
    }
    
    let assignedRole = role;
    
    // Logic for Worker Registration (Limit to max 2 workers)
    if (role === 'Worker' || role.startsWith('Worker')) {
      const existingWorkers = await pool.query("SELECT * FROM users WHERE role LIKE 'Worker%' ORDER BY id ASC");
      
      if (existingWorkers.rows.length >= 2) {
        return res.json({ success: false, message: 'Registration closed: Maximum of 2 Worker accounts reached!' });
      } else if (existingWorkers.rows.length === 0) {
        assignedRole = 'Worker 1';
      } else if (existingWorkers.rows.length === 1) {
        // Assign whatever role is missing
        const firstRole = existingWorkers.rows[0].role;
        assignedRole = (firstRole === 'Worker 1') ? 'Worker 2' : 'Worker 1';
      }
    }
    
    const newUser = await pool.query(
      'INSERT INTO users (full_name, email, password, role, delivery_address) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role, delivery_address',
      [full_name, email, password, assignedRole, delivery_address || '']
    );
    
    res.json({ success: true, user: newUser.rows[0], message: `Registered successfully as ${assignedRole}!` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Delete Order History for Client
app.delete('/api/orders/history/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE id = $1 AND status IN ('Delivered', 'Cancelled')", [orderId]);
    res.json({ success: true, message: 'Order history item deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});