// API: Register User (Strict 1 account for Worker 1 and 1 account for Worker 2)
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, worker_choice, delivery_address } = req.body;
  try {
    // Check if email already exists
    const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) {
      return res.json({ success: false, message: 'Email already registered!' });
    }
    
    let assignedRole = role;
    
    // Check Worker Account Limits
    if (role === 'Worker' || role.startsWith('Worker')) {
      const selectedWorker = worker_choice || 'Worker 1'; // Worker 1 or Worker 2
      
      // Check if this specific worker role is already taken
      const workerExist = await pool.query('SELECT * FROM users WHERE role = $1', [selectedWorker]);
      if (workerExist.rows.length > 0) {
        return res.json({
          success: false,
          message: `Account creation failed: An account for ${selectedWorker} already exists!`
        });
      }
      
      assignedRole = selectedWorker;
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