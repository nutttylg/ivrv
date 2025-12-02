const today = new Date();
console.log("Before setUTCHours:", today.toISOString(), today.getTime());
today.setUTCHours(0, 0, 0, 0);
console.log("After setUTCHours:", today.toISOString(), today.getTime());
console.log("Expected today 00:00 UTC:", 1764633600000);
