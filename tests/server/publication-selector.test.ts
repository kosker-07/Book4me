import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pool } from "../../server/db";
import app from "../../server/app";
import { hashPassword, issueSession } from "../../server/security";

test("publication agency selector: manager roles, tenant scope and sub-agency denial", async () => {
  const secret = process.env.SESSION_SECRET || "publication-selector-test-secret-32-chars";
  process.env.SESSION_SECRET = secret;
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const [masterA, masterB, subA, subB] = ids;
  const users = Array.from({ length: 4 }, () => randomUUID());
  const hotel = randomUUID(), room = randomUUID(), plan = randomUUID(), sale = randomUUID();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [id, name, type] of [[masterA, "Selector Master A", "master"], [masterB, "Selector Master B", "master"],
                                     [subA, "Selector Sub A", "sub"], [subB, "Selector Sub B", "sub"]])
      await pool.query("INSERT INTO agencies(id,name,type) VALUES ($1,$2,$3)", [id, name, type]);
    const roles = ["system_admin", "back_office", "master_agency", "sub_agency"] as const;
    const agencyIds = [null, null, masterA, subA];
    for (let i = 0; i < roles.length; i++)
      await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)",
        [users[i], `selector-${users[i]}@test.local`, hashPassword("selector-test-password"), roles[i], agencyIds[i]]);
    await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Selector Hotel','Test','active')", [hotel, masterA]);
    await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [room, hotel]);
    await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES ($1,$2,'BB','EUR')", [plan, room]);
    await pool.query("INSERT INTO agency_hotel_sales(id,agency_id,hotel_id,rate_plan_id,markup_type,markup_value) VALUES ($1,$2,$3,$4,'percent',10)",
      [sale, subA, hotel, plan]);
    for (let i = 0; i < roles.length; i++) {
      const token = issueSession({ sub: users[i]!, role: roles[i]!, agencyId: agencyIds[i], ver: 0 }, secret);
      const response = await fetch(base + "/api/admin/publication-agencies", { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, i === 3 ? 403 : 200, roles[i]);
      if (i === 3) continue;
      const data = await response.json() as { items: { id: string; name: string }[] };
      assert.ok(data.items.some(a => a.id === subA), `${roles[i]} should see published sub-agency`);
      assert.equal(data.items.some(a => a.id === subB), true, `${roles[i]} can select every active sub-agency`);
      assert.ok(data.items.every(a => Object.keys(a).sort().join(",") === "id,name"), "selector exposes only id/name");
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.query("DELETE FROM agency_hotel_sales WHERE id = $1", [sale]);
    await pool.query("DELETE FROM rate_plans WHERE id = $1", [plan]);
    await pool.query("DELETE FROM rooms WHERE id = $1", [room]);
    await pool.query("DELETE FROM hotels WHERE id = $1", [hotel]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
    await pool.query("DELETE FROM agencies WHERE id = ANY($1::uuid[])", [ids]);
  }
});
