// Defect register for QA round 3. `node defects.cjs add '<json>'` or require().add({...})
const fs = require('fs');
const path = require('path');
const FILE = path.resolve(__dirname, 'defects.json');
const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []);
function add(d) {
  const all = load();
  const i = all.findIndex((x) => x.id === d.id);
  if (i >= 0) all[i] = { ...all[i], ...d }; else all.push(d);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return d.id;
}
if (require.main === module) {
  if (process.argv[2] === 'add') console.log(add(JSON.parse(process.argv[3])));
  else console.log(load().map((d) => `${d.id}\t${d.severity}\t${d.title}`).join('\n'));
}
module.exports = { add, load };
