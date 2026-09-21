const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Koneksi PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'klinik_db',
    password: '1234', // Ganti dengan password PostgreSQL kamu
    port: 5432,
});

// Test Koneksi
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Gagal terhubung ke PostgreSQL:', err.message);
        console.log('💡 Pastikan PostgreSQL berjalan dan database "klinik_db" sudah dibuat!');
        return;
    }
    console.log('✅ Berhasil terhubung ke Database PostgreSQL (klinik_db)!');
    release();
});

// ================= API PASIEN =================
app.post('/api/pasien', async (req, res) => {
    let { no_rm, nama, tgl_lahir } = req.body;
    if (tgl_lahir && tgl_lahir.includes('T')) tgl_lahir = tgl_lahir.split('T')[0];

    try {
        const result = await pool.query(
            `INSERT INTO pasien (no_rm, nama, tgl_lahir) VALUES ($1, $2, $3) RETURNING id`,
            [no_rm, nama, tgl_lahir]
        );
        res.json({ id: result.rows[0].id, no_rm, nama });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/pasien', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, no_rm, nama, TO_CHAR(tgl_lahir, 'YYYY-MM-DD') AS tgl_lahir 
            FROM pasien ORDER BY nama ASC
        `);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Hapus 1 Pasien (ON DELETE CASCADE di DB akan otomatis hapus antrean & rekam medisnya)
app.delete('/api/pasien/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(`DELETE FROM pasien WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Hapus Semua Data
app.delete('/api/pasien/all', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM rekam_medis`);
        await client.query(`DELETE FROM antrean`);
        await client.query(`DELETE FROM pasien`);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ================= API ANTREAN =================
app.post('/api/antrean', async (req, res) => {
    const { pasien_id } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const waktuDaftar = now.toISOString().replace('T', ' ').split('.')[0];

    try {
        const countRes = await pool.query(`SELECT COUNT(*) as total FROM antrean WHERE tanggal = $1`, [today]);
        const no_urut = parseInt(countRes.rows[0].total) + 1;

        const insertRes = await pool.query(
            `INSERT INTO antrean (pasien_id, no_urut, tanggal, waktu_daftar, status) 
             VALUES ($1, $2, $3, $4, 'Menunggu') RETURNING id`,
            [pasien_id, no_urut, today, waktuDaftar]
        );
        res.json({ id: insertRes.rows[0].id, no_urut, status: 'Menunggu' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/antrean', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const result = await pool.query(`
            SELECT a.id, a.no_urut, a.status, a.waktu_daftar, p.nama, p.no_rm
            FROM antrean a 
            JOIN pasien p ON a.pasien_id = p.id
            WHERE a.tanggal = $1 
            ORDER BY a.no_urut ASC
        `, [today]);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= API REKAM MEDIS =================
app.post('/api/rekam-medis', async (req, res) => {
    const { pasien_id, keluhan, diagnosis, resep } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const tanggal = now.toISOString().replace('T', ' ').split('.')[0];
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Mulai Transaksi
        
        // 1. Simpan Rekam Medis
        const rmResult = await client.query(
            `INSERT INTO rekam_medis (pasien_id, keluhan, diagnosis, resep, tanggal) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [pasien_id, keluhan, diagnosis, resep, tanggal]
        );
        
        // 2. Update Status Antrean jadi 'Selesai'
        await client.query(
            `UPDATE antrean SET status = 'Selesai' WHERE pasien_id = $1 AND tanggal = $2`, 
            [pasien_id, today]
        );
        
        await client.query('COMMIT'); // Simpan Perubahan
        res.json({ success: true, id: rmResult.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK'); // Batalkan jika error
        res.status(500).json({ error: 'Transaksi gagal: ' + err.message });
    } finally {
        client.release();
    }
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
   
    console.log(`\x1b[32m✅ Server aktif di http://localhost:${PORT} (Mode: PostgreSQL)\x1b[0m`);
});