fetch('https://www.ngluxaries.store/api/support', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: '123', access_token: '123', message: 'hello' })
}).then(r => r.text().then(t => console.log(r.status, t))).catch(console.error);
