const params = new URLSearchParams(location.search);
document.getElementById('url').textContent = params.get('url') || '';
