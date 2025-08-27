// functions/_lib/cors.js
function cors() {
return {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "POST,OPTIONS",
"Access-Control-Allow-Headers": "content-type, authorization"
};
}
function json(res, status = 200) {
return {
statusCode: status,
headers: { ...cors(), "Content-Type": "application/json" },
body: JSON.stringify(res)
};
}
function text(body, status = 200) {
return {
statusCode: status,
headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
body
};
}
module.exports = { cors, json, text };
