// ============================================================
//  ROSSELL CREATIONS — Full Backend v2
//  Google Apps Script | Paste into your existing script
//  (Replace ALL existing code)
// ============================================================

const SHEET_NAME        = "Orders";
const DESIGNS_SHEET     = "Designs";
const LASER_SHEET       = "Laser Products";
const PRINT_SHEET       = "Print Products";
const REQUESTS_SHEET    = "Custom Requests";
const OWNER_EMAIL       = "brittany.n.rossell@gmail.com"; // ← your Gmail
const BUSINESS_NAME     = "Rossell Creations";
const SQUARE_LINK       = "https://square.link/u/18FbtiRu";

const ORDER_HEADERS  = ["Order #","Date","Customer Name","Customer Email","Items Summary","Total ($)","Source","Payment Status","Created?","Delivered?","Notes"];
const DESIGN_HEADERS = ["ID","Name","Category","Image URL","Active","Date Added"];
const LASER_HEADERS  = ["ID","Name","Icon","Description","Price","Active"];
const PRINT_HEADERS  = ["ID","Name","Icon","Description","Price","Size Category","Active"];
const REQUEST_HEADERS= ["Date","Type","Name","Contact","Description","Item Type","Status"];

// ── SHEET SETUP ──────────────────────────────────────────
function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const hr = sheet.getRange(1, 1, 1, headers.length);
    hr.setValues([headers]);
    hr.setBackground("#1A2E4A").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── CORS HEADERS ─────────────────────────────────────────
function setCORS(output) {
  return output; // GAS handles CORS via JSONP callback
}

function jsonpResponse(callback, data) {
  const json = JSON.stringify(data);
  const output = callback
    ? ContentService.createTextOutput(`${callback}(${json})`).setMimeType(ContentService.MimeType.JAVASCRIPT)
    : ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── doGET — serves data to storefront & admin ────────────
function doGet(e) {
  try {
    const action   = (e.parameter.action   || "list_orders");
    const callback = (e.parameter.callback || "");

    if (action === "list_orders") {
      return jsonpResponse(callback, getOrders());
    }
    if (action === "list_designs") {
      return jsonpResponse(callback, getDesigns());
    }
    if (action === "list_laser") {
      return jsonpResponse(callback, getLaserProducts());
    }
    if (action === "list_print") {
      return jsonpResponse(callback, getPrintProducts());
    }
    if (action === "list_requests") {
      return jsonpResponse(callback, getRequests());
    }
    if (action === "ping") {
      return jsonpResponse(callback, { status: "ok", message: "Connected to Rossell Creations backend!" });
    }

    return jsonpResponse(callback, { error: "Unknown action" });
  } catch(err) {
    const cb = (e.parameter && e.parameter.callback) || "";
    return jsonpResponse(cb, { error: err.message });
  }
}

// ── doPOST — receives orders & requests ──────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const type    = payload.type || "";

    if (type === "order") {
      return handleOrder(payload);
    }
    if (type === "custom_request") {
      return handleCustomRequest(payload);
    }
    // Square webhook
    if (payload.type && payload.type.startsWith("order.")) {
      return handleSquareWebhook(payload);
    }

    return jsonResponse({ status: "ok" });
  } catch(err) {
    Logger.log("doPost error: " + err.message);
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── ORDER HANDLING ────────────────────────────────────────
function handleOrder(payload) {
  const sheet   = getSheet(SHEET_NAME, ORDER_HEADERS);
  const orderNum = generateOrderNum();
  const date    = new Date().toLocaleDateString("en-US");

  // Build items summary
  const items   = payload.items || [];
  const summary = items.map(i =>
    `${i.qty}x ${i.label} (${i.detail}) - ${i.name} - $${i.total}`
  ).join(" | ");
  const total   = items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
  const custEmail = payload.customerEmail || "";
  const custName  = items[0]?.name || "Customer";

  const row = [
    orderNum, date, custName, custEmail, summary,
    total.toFixed(2), "Storefront", "Pending Payment",
    false, false, ""
  ];
  sheet.appendRow(row);
  formatLastRow(sheet, ORDER_HEADERS.length);

  // Email owner
  sendOwnerNotification(orderNum, custName, custEmail, items, total);

  // Email customer
  if (custEmail) {
    sendCustomerConfirmation(orderNum, custName, custEmail, items, total);
  }

  return jsonResponse({ status: "ok", orderNum });
}

function handleCustomRequest(payload) {
  const sheet = getSheet(REQUESTS_SHEET, REQUEST_HEADERS);
  const date  = new Date().toLocaleDateString("en-US");
  sheet.appendRow([
    date, payload.requestType || "General",
    payload.name || "", payload.contact || "",
    payload.description || "", payload.itemType || "",
    "New"
  ]);
  formatLastRow(sheet, REQUEST_HEADERS.length);

  // Email owner about custom request
  sendCustomRequestEmail(payload);

  return jsonResponse({ status: "ok" });
}

function handleSquareWebhook(payload) {
  // Mark order as paid when Square payment comes in
  const order = payload.data?.object?.order;
  if (!order) return jsonResponse({ status: "ok" });

  const sheet = getSheet(SHEET_NAME, ORDER_HEADERS);
  const data  = sheet.getDataRange().getValues();
  // Try to match by amount
  const total = (order.total_money?.amount || 0) / 100;
  for (let i = 1; i < data.length; i++) {
    if (parseFloat(data[i][5]) === total && data[i][7] === "Pending Payment") {
      sheet.getRange(i + 1, 8).setValue("Paid ✅");
      break;
    }
  }
  return jsonResponse({ status: "ok" });
}

// ── EMAIL FUNCTIONS ───────────────────────────────────────
function sendOwnerNotification(orderNum, custName, custEmail, items, total) {
  const itemsHtml = items.map(i => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:8px">${i.qty}x <strong>${i.label}</strong></td>
      <td style="padding:8px">${i.detail}</td>
      <td style="padding:8px">For: ${i.name}</td>
      <td style="padding:8px;font-weight:bold">$${i.total}</td>
    </tr>`).join("");

  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto">
      <div style="background:#1A2E4A;padding:24px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:24px">✿ Rossell Creations</h1>
        <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px">New Order Received!</p>
      </div>
      <div style="padding:24px;background:#FAF7F2">
        <h2 style="color:#1A2E4A">Order #${orderNum}</h2>
        <p><strong>Customer:</strong> ${custName}</p>
        <p><strong>Email:</strong> ${custEmail || "Not provided"}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString("en-US", {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:white;border-radius:8px;overflow:hidden">
          <thead><tr style="background:#1A2E4A;color:white">
            <th style="padding:10px;text-align:left">Item</th>
            <th style="padding:10px;text-align:left">Details</th>
            <th style="padding:10px;text-align:left">For</th>
            <th style="padding:10px;text-align:left">Price</th>
          </tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="background:#1A2E4A;color:white;padding:16px;border-radius:8px;display:flex;justify-content:space-between">
          <strong style="font-size:18px">Total Due:</strong>
          <strong style="font-size:24px;color:#C9A84C">$${total.toFixed(2)}</strong>
        </div>
        <p style="color:#888;font-size:12px;margin-top:16px">Customer has been directed to Square to pay. Check your Order Manager to track this order.</p>
      </div>
    </div>`;

  GmailApp.sendEmail(
    OWNER_EMAIL,
    `🛍 New Order #${orderNum} — ${custName} ($${total.toFixed(2)})`,
    `New order from ${custName}. Order #${orderNum}. Total: $${total.toFixed(2)}. Items: ${items.map(i=>i.label).join(', ')}`,
    { htmlBody: html, name: BUSINESS_NAME }
  );
}

function sendCustomerConfirmation(orderNum, custName, custEmail, items, total) {
  const itemsList = items.map(i =>
    `• ${i.qty}x ${i.label} — ${i.detail} — $${i.total}`
  ).join("\n");

  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto">
      <div style="background:#1A2E4A;padding:24px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:24px">✿ Rossell Creations</h1>
        <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px">Order Confirmation</p>
      </div>
      <div style="padding:24px;background:#FAF7F2">
        <h2 style="color:#1A2E4A">Thank you, ${custName}! 💛</h2>
        <p style="color:#555">Your order has been received. Your reference number is:</p>
        <div style="background:#1A2E4A;color:#C9A84C;padding:16px;text-align:center;border-radius:8px;font-size:24px;font-weight:bold;letter-spacing:4px;margin:16px 0">${orderNum}</div>
        <p style="color:#555">Keep this number handy if you need to follow up with us.</p>
        <h3 style="color:#1A2E4A">Your Order:</h3>
        <div style="background:white;padding:16px;border-radius:8px;border-left:4px solid #C9A84C">
          ${items.map(i=>`<p style="margin:6px 0"><strong>${i.qty}x ${i.label}</strong><br><span style="color:#888;font-size:13px">${i.detail} • For: ${i.name}</span><br><span style="color:#C9A84C;font-weight:bold">$${i.total}</span></p>`).join('<hr style="border:none;border-top:1px solid #eee">')}
        </div>
        <div style="background:#1A2E4A;color:white;padding:16px;border-radius:8px;margin-top:16px;text-align:center">
          <p style="margin:0 0 8px;opacity:.8;font-size:13px">Total</p>
          <p style="margin:0;font-size:28px;color:#C9A84C;font-weight:bold">$${total.toFixed(2)}</p>
        </div>
        <div style="background:#E8F5E9;padding:16px;border-radius:8px;margin-top:16px">
          <p style="margin:0;color:#2E7D32;font-size:14px">📦 <strong>What's next?</strong> Complete your payment via the Square link you were directed to. Once paid, your order will be in production! Most orders are ready in <strong>1–2 weeks</strong>.</p>
        </div>
        <p style="color:#888;font-size:12px;margin-top:20px;text-align:center">Questions? Find us on Facebook or reply to this email.<br><strong style="color:#1A2E4A">Rossell Creations — Veteran Owned · Teacher Made · Community Loved</strong></p>
      </div>
    </div>`;

  GmailApp.sendEmail(
    custEmail,
    `✿ Order Confirmed! #${orderNum} — Rossell Creations`,
    `Hi ${custName}! Your order #${orderNum} has been received. Total: $${total.toFixed(2)}. Ready in 1-2 weeks after payment. Questions? Find us on Facebook.`,
    { htmlBody: html, name: BUSINESS_NAME, replyTo: OWNER_EMAIL }
  );
}

function sendCustomRequestEmail(payload) {
  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto">
      <div style="background:#1A2E4A;padding:20px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:22px">✿ Rossell Creations</h1>
        <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px">New Custom Request</p>
      </div>
      <div style="padding:24px;background:#FAF7F2">
        <h2 style="color:#1A2E4A">New ${payload.requestType || "Custom"} Request</h2>
        <p><strong>Name:</strong> ${payload.name}</p>
        <p><strong>Contact:</strong> ${payload.contact}</p>
        ${payload.itemType ? `<p><strong>Item Type:</strong> ${payload.itemType}</p>` : ''}
        <div style="background:white;padding:16px;border-radius:8px;border-left:4px solid #C9A84C;margin-top:12px">
          <p style="margin:0;color:#555">${payload.description}</p>
        </div>
        <p style="color:#888;font-size:12px;margin-top:16px">Logged in your Custom Requests sheet.</p>
      </div>
    </div>`;

  GmailApp.sendEmail(
    OWNER_EMAIL,
    `✨ New ${payload.requestType || "Custom"} Request — ${payload.name}`,
    `New request from ${payload.name} (${payload.contact}): ${payload.description}`,
    { htmlBody: html, name: BUSINESS_NAME }
  );
}

// ── DATA GETTERS ──────────────────────────────────────────
function getOrders() {
  const sheet = getSheet(SHEET_NAME, ORDER_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { orders: [] };
  const headers = rows[0];
  return { orders: rows.slice(1).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]]))) };
}

function getDesigns() {
  const sheet = getSheet(DESIGNS_SHEET, DESIGN_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { designs: [] };
  const headers = rows[0];
  return { designs: rows.slice(1).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]]))) };
}

function getLaserProducts() {
  const sheet = getSheet(LASER_SHEET, LASER_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { products: [] };
  const headers = rows[0];
  return { products: rows.slice(1).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]]))) };
}

function getPrintProducts() {
  const sheet = getSheet(PRINT_SHEET, PRINT_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { products: [] };
  const headers = rows[0];
  return { products: rows.slice(1).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]]))) };
}

function getRequests() {
  const sheet = getSheet(REQUESTS_SHEET, REQUEST_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { requests: [] };
  const headers = rows[0];
  return { requests: rows.slice(1).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]]))) };
}

// ── HELPERS ───────────────────────────────────────────────
function generateOrderNum() {
  const d   = new Date();
  const yy  = String(d.getFullYear()).slice(2);
  const mm  = String(d.getMonth()+1).padStart(2,'0');
  const dd  = String(d.getDate()).padStart(2,'0');
  const rnd = Math.floor(Math.random()*9000)+1000;
  return `RC-${yy}${mm}${dd}-${rnd}`;
}

function formatLastRow(sheet, numCols) {
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 1, 1, numCols)
    .setBackground(lastRow % 2 === 0 ? "#F7F1EA" : "#FFFFFF");
}

// ── SEED DEFAULT DATA ─────────────────────────────────────
function seedDefaultData() {
  // Seed laser products
  const ls = getSheet(LASER_SHEET, LASER_HEADERS);
  if (ls.getLastRow() <= 1) {
    const laserData = [
      ["LP001","Keychain","🔑","Acrylic, wood, or leather. Personalized with name or design.",10,true],
      ["LP002","Metal Tumbler","☕","20–40oz metal tumbler. Wrap or spot engrave.",20,true],
      ["LP003","Ceramic Mug","🫖","Classic 11oz or 15oz ceramic mug.",20,true],
      ["LP004","Small Cutting Board","🪵","Personal-sized wood cutting board.",25,true],
      ["LP005","Large Cutting Board","🪵","Family-sized serving or cutting board.",40,true],
      ["LP006","Dark Acrylic Ornament","✨","Dark-colored acrylic only. Custom shape & design.",10,true],
      ["LP007","Nameplate / Desk Sign","🪧","Personalized desk nameplate or office sign.",25,true],
      ["LP008","Jewelry Dish","💍","Engraved keepsake dish for jewelry or trinkets.",20,true],
      ["LP009","Pet Tag","🐾","Durable metal pet ID or decorative tag.",10,true],
      ["LP010","Badge Reel","🏷️","Retractable badge reel — great for teachers & nurses.",10,true],
      ["LP011","Bookmark","📖","Engraved metal or wood bookmark.",5,true],
      ["LP012","Award Plaque (Small 4×6)","🏅","Individual recognition award.",20,true],
      ["LP013","Award Plaque (Med 6×8)","🏆","Team or recognition plaque.",30,true],
      ["LP014","Award Plaque (Large 8×10)","🥇","Championship or group award.",40,true],
    ];
    ls.getRange(2, 1, laserData.length, LASER_HEADERS.length).setValues(laserData);
  }

  // Seed 3D print products
  const ps = getSheet(PRINT_SHEET, PRINT_HEADERS);
  if (ps.getLastRow() <= 1) {
    const printData = [
      ["PP001","Fidget Spinner","🌀","Classic spinning fidget toy.",5,"Small",true],
      ["PP002","Fidget Cube","🎲","Multi-function fidget with buttons & dials.",5,"Small",true],
      ["PP003","Keychain","🔑","Custom 3D printed keychain — any shape.",5,"Small",true],
      ["PP004","Name Badge","🏷️","Custom classroom or event name badge.",5,"Small",true],
      ["PP005","Phone Stand","📱","Desktop phone or tablet stand.",15,"Medium",true],
      ["PP006","Pencil Holder","✏️","Desk organizer for classroom or office.",15,"Medium",true],
      ["PP007","Small Planter","🌱","Cute desktop planter for succulents.",15,"Medium",true],
      ["PP008","Desk Organizer","📋","Multi-compartment desk tray.",30,"Large",true],
      ["PP009","Large Planter","🪴","Full-sized decorative planter.",30,"Large",true],
      ["PP010","Holiday Decor","🎄","Seasonal decorative display piece.",30,"Large",true],
    ];
    ps.getRange(2, 1, printData.length, PRINT_HEADERS.length).setValues(printData);
  }

  Logger.log("✅ Default data seeded!");
}

// ── TEST FUNCTION ─────────────────────────────────────────
function testFullSetup() {
  // Create all sheets
  getSheet(SHEET_NAME, ORDER_HEADERS);
  getSheet(DESIGNS_SHEET, DESIGN_HEADERS);
  getSheet(LASER_SHEET, LASER_HEADERS);
  getSheet(PRINT_SHEET, PRINT_HEADERS);
  getSheet(REQUESTS_SHEET, REQUEST_HEADERS);

  // Seed data
  seedDefaultData();

  // Test order email
  handleOrder({
    type: "order",
    customerEmail: OWNER_EMAIL,
    items: [{
      label: "Trojan Spirit — T-Shirt",
      detail: "Adult L · Gildan · Black",
      name: "Test Customer",
      qty: 1, total: 15
    }]
  });

  Logger.log("✅ Full setup complete! Check your email and Google Sheet.");
}
