// Fork cleanup regression test for the self-hosted Beachy Beachy Ball build.
//
//   node test/fork-cleanup.cjs
//
// Zero dependencies. Three layers:
//   1. Static assertions on src/index.html: the Google Analytics / Google Tag
//      Manager loader removed by this fork stays removed, and no source file
//      references the removed tracking globals.
//   2. Functional and attribution surfaces this fork must keep are present.
//   3. A syntax check of every inline <script> block in src/index.html.
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');
var index = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
var mainMenu = fs.readFileSync(path.join(SRC, 'interface', 'MainMenu.jsx'), 'utf8');
var iface = fs.readFileSync(path.join(SRC, 'interface', 'Interface.jsx'), 'utf8');

var failures = 0;
function check(desc, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + desc);
  if (!ok) failures++;
}
function absentEverywhere(needle, desc) {
  var hits = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      var full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.(js|jsx|ts|tsx|html|css|json)$/.test(entry.name)) return;
      var text = fs.readFileSync(full, 'utf8');
      if (text.indexOf(needle) !== -1) hits.push(path.relative(ROOT, full));
    });
  })(SRC);
  check(desc + ' absent from every source file (' + needle + ')', hits.length === 0);
  if (hits.length) console.log('   found in: ' + hits.join(', '));
}

// --- tracking surfaces removed ---------------------------------------------
['googletagmanager.com', 'gtm.js', 'GTM-NPLSZVZ', 'GA_TRACKING_ID', 'VITE_GA_TRACKING_ID',
  'window.dataLayer', 'window.gtag', "gtag('config'", 'gtag.js'].forEach(function (needle) {
  absentEverywhere(needle, 'analytics/ads loader');
});

// --- functional and attribution surfaces preserved -------------------------
var keptInIndex = [
  ['game entry module', 'src="./index.jsx"'],
  ['React root', '<div id="root">'],
  ['page title', 'Beachy Beachy Ball'],
  ['author meta', '<meta name="author" content="Michael Kolesidis" />'],
  ['favicon', './icons/favicon.ico'],
  ['viewport meta', 'name="viewport"']
];
keptInIndex.forEach(function (pair) {
  check(pair[0] + ' kept in src/index.html', index.indexOf(pair[1]) !== -1);
});

check('in-game copyright attribution kept', iface.indexOf('https://michaelkolesidis.com') !== -1);
check('in-game AGPL license link kept', iface.indexOf('https://www.gnu.org/licenses/agpl-3.0.en.html') !== -1);
check('main menu source link kept', mainMenu.indexOf('https://github.com/michaelkolesidis/beachy-beachy-ball') !== -1);
check('main menu level selection kept', mainMenu.indexOf('copacabana') !== -1);
check('gameplay store preserved', fs.existsSync(path.join(SRC, 'stores', 'useGame.js')));

// --- no dangling references to removed globals -----------------------------
['dataLayer', 'gtag'].forEach(function (id) {
  var used = index.indexOf(id) !== -1;
  check('no dangling reference to removed global ' + id, !used);
});

// --- every inline <script> block still parses -------------------------------
var scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
var match, count = 0, syntaxErrors = 0;
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beachy-inline-'));
while ((match = scriptRe.exec(index)) !== null) {
  var attrs = match[1];
  var body = match[2];
  if (/type\s*=\s*["'](application\/ld\+json|text\/template)["']/.test(attrs)) continue;
  if (/\ssrc\s*=/.test(attrs)) continue;
  if (!body.trim()) continue;
  count++;
  var file = path.join(tmpDir, 'inline-' + count + '.mjs');
  fs.writeFileSync(file, body);
  var res = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    syntaxErrors++;
    console.log('FAIL inline script #' + count + ' has a syntax error:');
    console.log((res.stderr || '').split('\n').slice(0, 4).join('\n'));
  }
}
check('all ' + count + ' inline scripts parse cleanly', syntaxErrors === 0);

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(failures + ' check(s) failed');
  process.exit(1);
}
console.log('fork cleanup checks passed');
