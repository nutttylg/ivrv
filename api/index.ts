export const config = {
  runtime: 'edge',
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Implied vs Realized Volatility</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; background: #0a0a0a; color: #e0e0e0; padding: 20px; }
        .loading { text-align: center; padding: 50px; color: #666; }
    </style>
</head>
<body>
    <div class="loading">
        <h1>Loading Volatility Data...</h1>
        <p>Fetching from Deribit and Binance APIs...</p>
    </div>
    <script>
        // Redirect to the HTML file
        window.location.href = '/index-v2.html';
    </script>
</body>
</html>`;

export default async function handler() {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}
