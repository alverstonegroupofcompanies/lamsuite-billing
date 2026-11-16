/** Why can a sixth workstation not be enrolled? Capture the activation API's answer. */
const { BACKEND, sql, saveEvidence } = require('./driver.cjs');
const manifest = require('./manifest.json');

(async () => {
  const out = { probes: [] };
  for (const code of ['QA-A', 'QA-E']) {
    const st = manifest.stores[code];
    const body = { activation_key: st.activation_key, counter_name: `QA ${code} Probe Counter ${Date.now().toString().slice(-4)}`, device_uuid: `probe_${Date.now()}`, app_version: '2.0.36' };
    const res = await fetch(`${BACKEND}/api/register-device`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const text = await res.text();
    out.probes.push({ store: code, status: res.status, body: text.slice(0, 400) });
    console.log(`${res.status} ${code} ${text.slice(0, 220)}`);
  }
  out.devices_per_store = sql('select store_id, count(*) c, max(id) newest from devices group by store_id order by store_id');
  out.device_cols = sql('pragma table_info(devices)').map(c => c.name);
  out.attempt_cols = sql('pragma table_info(device_activation_attempts)').map(c => c.name);
  out.attempts = sql('select store_id, device_uuid, ip_address, success, failure_reason, attempted_key_prefix, created_at from device_activation_attempts order by id desc limit 12');
  console.log('\ndevices per store:', JSON.stringify(out.devices_per_store));
  console.log('recent attempts:', JSON.stringify(out.attempts).slice(0, 900));
  saveEvidence('A6_enrollment_probe.json', out);
})();
