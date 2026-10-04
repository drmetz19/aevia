-- Login staf mencari email lintas klinik SEBELUM tenant diketahui, memakai koneksi pemilik tepercaya.
-- Karena itu staff tidak di-FORCE: pemilik tabel melewati RLS, sedangkan aevia_app (role aplikasi) tetap terikat kebijakan tenant.
ALTER TABLE staff NO FORCE ROW LEVEL SECURITY;
