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
    for (const name of ['view/open_nexttrace/main.js', 'view/open_nexttrace/settings.js', 'open_nexttrace/map.js']) {
        assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(resources, name), 'utf8')));
    }
});
test('status polling survives LuCI immediate first tick before the view is mounted', () => {
    const source = fs.readFileSync(path.join(resources, 'view/open_nexttrace/main.js'), 'utf8');
    assert.match(source, /if \(self\.wasConnected\) \{\s*poll\.remove\(self\.pollFn\)/);
    assert.match(source, /self\.wasConnected = true;\s*if \(self\.starting\)/);
    assert.doesNotMatch(source, /if \(!self\.root\.isConnected\) \{\s*poll\.remove\(self\.pollFn\)/);
});
test('trace toolbar keeps only per-run routing and provider choices', () => {
    const source = fs.readFileSync(path.join(resources, 'view/open_nexttrace/main.js'), 'utf8');
    for (const label of ['协议', '地址类型', 'DNS 提供方', 'IP 解析 API', 'WAN 口'])
        assert.ok(source.includes(`field('${label}'`), label);
    for (const label of ['追踪设置', "field('最大跳数'", "field('每跳探测次数'", "field('探测超时 (ms)'",
        "field('目标端口'", "field('反向 DNS 查询'"])
        assert.ok(!source.includes(label), label);
    assert.match(source, /max_hops: this\.settings\.max_hops/);
    assert.match(source, /this\.protocol\.value === 'udp' \? this\.settings\.udp_port : this\.settings\.tcp_port/);
});
test('interface DNS follows the WAN selected for this trace', () => {
    const source = fs.readFileSync(path.join(resources, 'view/open_nexttrace/main.js'), 'utf8');
    const view = new Function('view', 'rpc', 'poll', 'uci', 'trace', 'L', 'E', source)(
        {extend:x=>x}, {declare:()=>()=>{}}, {}, {}, trace, {}, () => {});
    view.dnsMode = {value: 'interface'};
    view.device = {value: 'wan.v2'};
    view.settings = {dns_interface: 'wan', dns_server: '8.8.8.8', dns_port: 53};
    view.interfaces = [
        {name:'wan', device:'wan', up:true, wan:true, dns:['1.1.1.1'], addresses:['10.0.0.2']},
        {name:'wan_cmcc', device:'wan.v2', up:true, wan:true, dns:['223.5.5.5'], addresses:['10.0.1.2']}
    ];
    assert.deepEqual(view.resolverOptions(), {server:'223.5.5.5', port:53, source:'10.0.1.2'});
});
test('DNS runs only after Start; multiple addresses allow a later IP selection', async () => {
    const source = fs.readFileSync(path.join(resources, 'view/open_nexttrace/main.js'), 'utf8');
    const starts = [];
    let resolves = 0;
    let answers = ['110.185.124.145', '110.185.124.144'];
    const E = (tag, attrs, children) => ({tag, attrs, children});
    const view = new Function('view', 'rpc', 'poll', 'uci', 'trace', 'L', 'E', source)(
        {extend:x=>x}, {declare:config => (...args) => config.method === 'resolve' ?
            (resolves++, Promise.resolve({addresses:answers})) : config.method === 'start' ?
            (starts.push(args), Promise.resolve({status:'running'})) : Promise.resolve({})}, {}, {}, trace, {}, E);
    view.target = {value:'example.com'};
    view.family = {value:'4'};
    view.protocol = {value:'icmp'};
    view.device = {value:''};
    view.provider = {value:'NextTrace-API'};
    view.dnsMode = {value:'system'};
    view.targetIP = {hidden:true, options:[], value:'', replaceChildren() {this.options=[]; this.value='';},
        appendChild(option) {this.options.push(option); if (this.options.length === 1) this.value=option.attrs.value;}};
    view.settings = {max_hops:30, queries:3, timeout:1000, tcp_port:80, udp_port:33494, rdns:true};
    view.controls = [];
    view.canWrite = true;
    view.available = true;
    view.startButton = {};
    view.setMessage = () => {};
    view.setBusy = () => {};
    view.applyStatus = () => {};
    view.clearResolution();
    assert.equal(resolves, 0);
    assert.equal(view.targetIP.hidden, true);
    await view.begin();
    assert.equal(resolves, 1);
    assert.equal(starts[0][0], answers[0]);
    assert.equal(view.targetIP.hidden, false);
    assert.deepEqual(view.targetIP.options.map(x=>x.attrs.value), answers);
    assert.equal(view.targetIP.value, answers[0]);
    view.targetIP.value = answers[1];
    await view.begin();
    assert.equal(resolves, 1);
    assert.equal(starts[1][0], answers[1]);
    assert.equal(view.target.value, 'example.com');
    view.target.value = 'new.example.com';
    view.clearResolution();
    assert.equal(resolves, 1);
    assert.equal(view.targetIP.hidden, true);
    assert.equal(view.resolvedAddresses.length, 0);
    answers = ['192.0.2.1'];
    await view.begin();
    assert.equal(resolves, 2);
    assert.equal(starts[2][0], answers[0]);
    assert.equal(view.targetIP.hidden, true);
    assert.deepEqual(view.resolvedAddresses, answers);
});
test('stop button is red only while a writable trace is running', () => {
    const source = fs.readFileSync(path.join(resources, 'view/open_nexttrace/main.js'), 'utf8');
    const view = new Function('view', 'rpc', 'poll', 'uci', 'trace', 'L', 'E', source)(
        {extend:x=>x}, {declare:()=>()=>{}}, {}, {}, trace, {}, () => {});
    view.controls = [];
    view.available = true;
    view.canWrite = true;
    view.startButton = {};
    view.stopButton = {classList:{toggle(name, active){view.stopActive = active;}}};
    view.setBusy(true);
    assert.equal(view.stopActive, true);
    assert.equal(view.stopButton.disabled, false);
    view.setBusy(false);
    assert.equal(view.stopActive, false);
    assert.equal(view.stopButton.disabled, true);
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
