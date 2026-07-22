#!/usr/bin/env node
/**
 * Staff PIN management.
 *
 *   node scripts/staff.mjs add "Amaka" 1234
 *   node scripts/staff.mjs list
 *   node scripts/staff.mjs disable "Amaka"
 *
 * PINs are never stored in plain text and never printed back.
 */

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/* ── load .env.local without extra dependencies ─────────────── */
function loadEnv(file = ".env.local") {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.error(`Could not read ${file}. Run this from the project root.`);
    process.exit(1);
  }
}
loadEnv();

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_PIN_SECRET } = process.env;

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  STAFF_PIN_SECRET,
})) {
  if (!value) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
}

const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const hashPin = (pin) => createHmac("sha256", STAFF_PIN_SECRET).update(pin.trim()).digest("hex");

/* ── commands ───────────────────────────────────────────────── */

const [, , command, ...args] = process.argv;

switch (command) {
  case "add":
    await add(args[0], args[1]);
    break;
  case "list":
    await list();
    break;
  case "disable":
    await disable(args[0]);
    break;
  default:
    console.log(`
Usage:
  node scripts/staff.mjs add "Name" 1234
  node scripts/staff.mjs list
  node scripts/staff.mjs disable "Name"
`);
}

async function add(name, pin) {
  if (!name || !pin) {
    console.error('Usage: node scripts/staff.mjs add "Amaka" 1234');
    process.exit(1);
  }
  if (!/^\d{4}$/.test(pin)) {
    console.error("PIN must be exactly 4 digits.");
    process.exit(1);
  }

  const { error } = await db.from("staff").insert({ name, pin_hash: hashPin(pin) });

  if (error) {
    if (error.code === "23505") {
      console.error("That PIN is already taken by another staff member. Pick a different one.");
    } else {
      console.error("Failed:", error.message);
    }
    process.exit(1);
  }

  console.log(`Added ${name}. They can sign in with their PIN now.`);
}

async function list() {
  const { data, error } = await db
    .from("staff")
    .select("name, is_active, created_at")
    .order("created_at");

  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }
  if (!data.length) {
    console.log("No staff yet. Add one with: node scripts/staff.mjs add \"Amaka\" 1234");
    return;
  }

  console.log("\nStaff:");
  for (const s of data) {
    console.log(`  ${s.is_active ? "active " : "disabled"}  ${s.name}`);
  }
  console.log("");
}

async function disable(name) {
  if (!name) {
    console.error('Usage: node scripts/staff.mjs disable "Amaka"');
    process.exit(1);
  }
  const { error, count } = await db
    .from("staff")
    .update({ is_active: false }, { count: "exact" })
    .eq("name", name);

  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }
  console.log(count ? `${name} can no longer sign in.` : `No staff named ${name}.`);
}
