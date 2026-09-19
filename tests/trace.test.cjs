const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const resources = path.join(__dirname, '../luci-app-open_nexttrace/htdocs/luci-static/resources');
const trace = new Function('baseclass', fs.readFileSync(path.join(resources, 'open_nexttrace/trace.js'), 'utf8'))({ extend: x => x });
const record = (ttl, ip, ms, lat = '31.23', lon = '121.47', host = 'router.example') =>
    `${ttl}|${ip}|${host}|${ms}|4134|中国|上海|上海||China Telecom|${lat}|${lon}\n`;

test('parses real RAW columns, zero RTT and compact timeout records', () => {
    const rows = trace.parse(record(1, '192.168.1.1', '0.00') + '2|*||||||\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].average, 0);
    assert.equal(rows[0].asn, 'AS4134');
    assert.equal(rows[0].location, '中国 上海 上海');
    assert.equal(rows[1].loss, 100);
});
test('combines probes, preserves ECMP responders, counts timeouts at hop level', () => {
    const rows = trace.parse(record(1, '1.1.1.1', '10') + record(1, '1.1.1.1', '20') +
        record(1, '1.0.0.1', '30') + '1|*||||||\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].average, 15);
    assert.equal(rows[0].loss, 25);
    assert.equal(rows[1].loss, 25);
    assert.equal(trace.points(rows).length, 1);
});
test('ignores banners, invalid records and a partially written final line', () => {
    assert.deepEqual(trace.parse('NextTrace v1.7.3\n0|*||||||\n65|*||||||\n1|*\n' +
        record(2, '1.1.1.1', 'NaN') + record(2, 'bad-ip', 2) + record(2, '1.1.1.1', 2).trimEnd()), []);
});
test('IPv6 is retained; invalid coordinates and unknown 0,0 are excluded', () => {
    const rows = trace.parse(record(1, '2001:db8::1', '1', '0', '25') +
        record(2, '2001:db8::2', '1', '10', '0') + record(3, '::1', '1', '0', '0') +
        record(4, '2001:db8::4', '1', '91', '20') + record(5, '2001:db8::5', '1', '', ''));
    assert.equal(rows.length, 5);
    assert.equal(trace.points(rows).length, 2);
});
test('unwraps the date line using the shortest segment and leaves original data intact', () => {
    const rows = trace.parse(record(1, '1.1.1.1', 1, 10, 170) + record(2, '1.0.0.1', 2, 20, -170));
    const points = trace.points(rows);
    assert.equal(points[1].lon, 190);
    assert.equal(rows[1].lon, -170);
});
test('CSV escapes quotes, separators and spreadsheet formulas', () => {
    const rows = trace.parse(record(1, '1.1.1.1', 1, 10, 20, '=HYPERLINK("bad", "bad")'));
    const csv = trace.csv(rows);
    assert.ok(csv.startsWith('\ufeff'));
    assert.ok(csv.includes('"\'=HYPERLINK(""bad"", ""bad"")"'));
});
test('all first-party browser JavaScript parses', () => {
    for (const name of ['view/open_nexttrace/main.js', 'open_nexttrace/map.js']) {
        assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(resources, name), 'utf8')));
    }
});
test('LuCI rows render remote hostnames and GeoIP fields as text, never HTML', () => {
    const unsafe = [];
    const E = (tag, attrs, children) => {
        if (typeof children === 'string' && children.includes('<')) unsafe.push(children);
        return { tag, attrs, children, appendChild() {} };
    };
    const view = new Function('view', 'rpc', 'poll', 'trace', 'L', 'E',
        fs.readFileSync(path.join(resources, 'view/open_nexttrace/main.js'), 'utf8'))(
        {extend:x=>x}, {declare:()=>()=>{}}, {}, trace, {}, E);
    const attack = '<img src=x onerror=alert(document.cookie)>';
    view.rows = trace.parse(record(1, '1.1.1.1', 1, 10, 20, attack));
    view.rows[0].owner = attack;
    view.rows[0].location = attack;
    view.body = {replaceChildren(){}, appendChild(){}};
    view.summary = {};
    view.exportButton = {};
    view.renderRows();
    assert.deepEqual(unsafe, []);
});
