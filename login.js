document.getElementById('f').onsubmit = async ev => {
  ev.preventDefault();
  const e = document.getElementById('e'); e.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('p').value }) });
    if (r.ok) return location.replace('/');
    e.textContent = r.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : 'Contraseña incorrecta';
  } catch { e.textContent = 'Sin conexión con el servidor'; }
};
