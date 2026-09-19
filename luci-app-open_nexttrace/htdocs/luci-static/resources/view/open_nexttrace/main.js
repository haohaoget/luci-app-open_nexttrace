'use strict';
'require view';
'require rpc';
'require poll';
'require open_nexttrace.trace as trace';

var info = rpc.declare({ object: 'open_nexttrace', method: 'info', expect: { '': {} }, reject: true });
var status = rpc.declare({ object: 'open_nexttrace', method: 'status', params: ['id'], expect: { '': {} }, reject: true });
var start = rpc.declare({ object: 'open_nexttrace', method: 'start',
    params: ['target', 'protocol', 'family', 'device', 'max_hops', 'queries', 'timeout', 'port', 'provider', 'rdns'],
    expect: { '': {} }, reject: true });
var stop = rpc.declare({ object: 'open_nexttrace', method: 'stop', params: ['id'], expect: { '': {} }, reject: true });

// LuCI interprets bare string children as HTML. Always use text nodes for
// strings, especially PTR names and data returned by GeoIP services.
function el(tag, attributes, children) {
    return E(tag, attributes, typeof children === 'string' ? [children] : children);
}

function checked(result) {
    if (result.error) throw new Error(result.error);
    return result;
}
function select(items, value) {
    return el('select', {}, items.map(function(item) {
        return el('option', { value: item[0], selected: item[0] === value ? '' : null }, item[1]);
    }));
}
function field(title, input, cls) {
    return el('label', { 'class': 'ont-field ' + (cls || '') }, [el('span', {}, title), input]);
}
function number(value, min, max) { return el('input', { type: 'number', value: value, min: min, max: max, step: 1 }); }

return view.extend({
    handleSave: null, handleSaveApply: null, handleReset: null,

    load: function() {
        return Promise.all([info().then(checked), status('')]);
    },

    render: function(data) {
        var self = this, settings = {};
        try { settings = JSON.parse(localStorage.getItem('open-nexttrace-settings') || '{}'); } catch (e) { /* defaults */ }
        this.rows = [];
        this.available = data[0].available;
        this.canWrite = !L.hasViewPermission || L.hasViewPermission();
        this.target = el('input', { type: 'text', placeholder: '输入域名或 IP 地址，例如 one.one.one.one', maxlength: 253,
            autocomplete: 'off', spellcheck: 'false', value: settings.target || '' });
        this.protocol = select([['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP']], settings.protocol || 'icmp');
        this.family = select([['auto', '自动'], ['4', 'IPv4'], ['6', 'IPv6']], settings.family || 'auto');
        this.device = select([['', '默认出口（系统路由）']], '');
        this.provider = select([['NextTrace-API', 'NextTrace API'], ['IP.SB', 'IP.SB'], ['IPInfo', 'IPInfo'], ['disable-geoip', '关闭地理查询']], settings.provider || 'NextTrace-API');
        this.maxHops = number(settings.max_hops || 30, 1, 64);
        this.queries = number(settings.queries || 3, 1, 5);
        this.timeout = number(settings.timeout || 1000, 100, 5000);
        this.port = number(settings.port || 80, 1, 65535);
        this.rdns = el('input', { type: 'checkbox', checked: settings.rdns !== false ? '' : null });
        this.protocol.addEventListener('change', function() {
            self.port.value = self.protocol.value === 'udp' ? '33494' : '80';
            self.port.disabled = self.protocol.value === 'icmp';
        });
        this.port.disabled = this.protocol.value === 'icmp';
        this.message = el('span', { role: 'status', 'aria-live': 'polite' }, '准备就绪');
        this.summary = el('span', { 'class': 'ont-muted' }, '等待开始追踪');
        this.body = el('tbody');
        this.diagnostics = el('pre', { 'class': 'ont-diagnostics' });
        this.logPanel = el('details', { 'class': 'ont-log' }, [el('summary', {}, '核心日志'), this.diagnostics]);
        this.startButton = el('button', { 'class': 'cbi-button cbi-button-action ont-start', click: function() { self.begin(); } }, '开始追踪');
        this.stopButton = el('button', { 'class': 'cbi-button ont-stop', disabled: '', click: function() { self.cancel(); } }, '停止');
        this.exportButton = el('button', { 'class': 'cbi-button', disabled: '', click: function() { self.exportCSV(); } }, '导出 CSV');
        this.refreshButton = el('button', { 'class': 'cbi-button', title: '重新读取 WAN、PPPoE、VPN 等接口', click: function() { self.refreshInterfaces(); } }, '刷新接口');
        this.map = el('iframe', { 'class': 'ont-map', title: '逐跳路由地图', src: L.resource('open_nexttrace/map.html') });
        this.map.addEventListener('load', function() { self.sendMap(); });
        this.mapListener = function(event) {
            if (event.origin !== location.origin || event.source !== self.map.contentWindow || !event.data) return;
            if (event.data.type === 'open-nexttrace-select') self.highlight(event.data.key);
        };
        window.addEventListener('message', this.mapListener);
        this.controls = [this.target, this.protocol, this.family, this.device, this.provider,
            this.maxHops, this.queries, this.timeout, this.port, this.rdns];
        this.root = el('div', { 'class': 'ont-app' }, [
            el('link', { rel: 'stylesheet', href: L.resource('open_nexttrace/style.css') }),
            el('header', { 'class': 'ont-heading' }, [
                el('div', {}, [el('h2', {}, 'Open NextTrace'), el('p', {}, '从路由器出发，看清每一跳。')]),
                el('span', { 'class': 'ont-version' }, 'NextTrace ' + (data[0].version || (data[0].available ? '已安装' : '未安装')))
            ]),
            el('section', { 'class': 'ont-toolbar' }, [
                field('追踪目标', this.target, 'ont-target'), field('协议', this.protocol),
                field('地址类型', this.family), field('出口接口', this.device, 'ont-device'),
                el('div', { 'class': 'ont-actions' }, [this.startButton, this.stopButton])
            ]),
            el('details', { 'class': 'ont-settings' }, [el('summary', {}, '追踪设置'),
                el('div', { 'class': 'ont-settings-grid' }, [field('IP 数据源', this.provider),
                    field('最大跳数', this.maxHops), field('每跳探测次数', this.queries),
                    field('探测超时 (ms)', this.timeout), field('目标端口', this.port),
                    field('反向 DNS 查询', this.rdns), this.refreshButton]),
                el('p', { 'class': 'ont-muted' }, '默认出口遵循系统路由；选择接口后使用该设备探测。DNS 与 IP 地理查询仍使用系统网络。单次追踪最长 180 秒。')
            ]),
            el('div', { 'class': 'ont-statusbar' }, [this.message, this.summary, this.exportButton]),
            el('section', { 'class': 'ont-results', 'aria-label': '路由追踪结果' }, [
                el('table', { 'class': 'ont-table' }, [el('thead', {}, el('tr', {},
                    ['#', 'IP 地址', '时间 (ms)', '地理位置', '组织', 'AS', '主机名', '未响应'].map(function(h) { return el('th', {}, h); })
                )), this.body])
            ]),
            el('section', { 'class': 'ont-map-panel' }, [
                el('div', { 'class': 'ont-map-heading' }, [el('strong', {}, '路由地图'),
                    el('span', {}, '点击节点查看详情 · 点击表格定位'),
                    el('button', { 'class': 'cbi-button', click: function() { self.sendMap(true); } }, '显示完整路径')]),
                this.map,
                el('p', { 'class': 'ont-map-note' }, '地理位置为 IP 数据库估算。多路径时连接每跳首个有坐标的节点，虚线表示中间存在未定位跳点。地图瓦片由浏览器从 OpenStreetMap 加载。')
            ]), this.logPanel
        ]);
        this.populateInterfaces(data[0].interfaces || [], '');
        this.target.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !self.startButton.disabled) self.begin();
        });
        this.applyStatus(data[1]);
        if (!this.available) this.setMessage('未安装核心，请安装 open-nexttrace-core 软件包', true);
        this.pollFn = function() {
            if (!self.root.isConnected) {
                poll.remove(self.pollFn);
                window.removeEventListener('message', self.mapListener);
                return Promise.resolve();
            }
            if (self.starting) return Promise.resolve();
            return status('').then(function(result) { if (!self.starting) self.applyStatus(result); }).catch(function(error) {
                self.setMessage('无法读取任务状态：' + error.message, true);
            });
        };
        poll.add(this.pollFn, 1);
        return this.root;
    },

    populateInterfaces: function(interfaces, selected) {
        interfaces = Array.isArray(interfaces) ? interfaces : [];
        this.device.replaceChildren(el('option', { value: '' }, '默认出口（系统路由）'));
        var seen = {};
        interfaces.forEach(function(iface) {
            var key = iface.device;
            if (seen[key]) return;
            seen[key] = true;
            var names = interfaces.filter(function(i) { return i.device === key; }).map(function(i) { return i.name; }).join(' / ');
            var up = interfaces.some(function(i) { return i.device === key && i.up; });
            this.device.appendChild(el('option', { value: key, disabled: up ? null : '', selected: key === selected ? '' : null },
                names + ' · ' + key + (iface.wan ? ' · WAN' : '') + (up ? '' : '（离线）')));
        }, this);
    },

    refreshInterfaces: function() {
        var self = this;
        this.refreshButton.disabled = true;
        return info().then(checked).then(function(result) {
            self.available = result.available;
            self.populateInterfaces(result.interfaces || [], self.device.value);
            self.setMessage('接口列表已更新');
            self.setBusy(self.running);
        }).catch(function(e) { self.setMessage(e.message, true); }).finally(function() { self.refreshButton.disabled = false; });
    },

    setMessage: function(message, error) {
        this.message.textContent = message;
        this.message.className = error ? 'ont-error' : (this.running ? 'ont-running' : '');
    },

    setBusy: function(running) {
        this.running = running;
        this.controls.forEach(function(control) { control.disabled = running || !this.canWrite; }, this);
        this.port.disabled = running || !this.canWrite || this.protocol.value === 'icmp';
        this.startButton.disabled = running || !this.available || !this.canWrite;
        this.stopButton.disabled = !running || !this.canWrite;
        this.refreshButton.disabled = running;
    },

    begin: function() {
        var self = this;
        if (!this.controls.every(function(control) { return control.reportValidity(); })) return;
        var options = { target: this.target.value.trim(), protocol: this.protocol.value, family: this.family.value,
            device: this.device.value, max_hops: Number(this.maxHops.value), queries: Number(this.queries.value),
            timeout: Number(this.timeout.value), port: Number(this.port.value), provider: this.provider.value, rdns: this.rdns.checked };
        if (!options.target) { this.target.focus(); this.setMessage('请输入追踪目标', true); return; }
        this.setBusy(true);
        this.starting = true;
        this.setMessage('正在启动追踪…');
        return start(options.target, options.protocol, options.family, options.device, options.max_hops,
            options.queries, options.timeout, options.port, options.provider, options.rdns).then(checked).then(function(result) {
                try { localStorage.setItem('open-nexttrace-settings', JSON.stringify(options)); } catch (e) { /* optional */ }
                self.starting = false;
                self.applyStatus(result);
            }).catch(function(error) { self.starting = false; self.setBusy(false); self.setMessage(error.message, true); });
    },

    cancel: function() {
        var self = this;
        this.stopButton.disabled = true;
        return stop(this.jobId).then(checked).then(function() { self.setMessage('正在停止…'); }).catch(function(error) {
            self.stopButton.disabled = false; self.setMessage(error.message, true);
        });
    },

    applyStatus: function(result) {
        if (!result.status) { if (result.error) this.setMessage(result.error, true); return; }
        if (this.lastStatus === result.status && this.jobId === result.id && result.status !== 'running') return;
        var changedStatus = this.lastStatus !== result.status;
        this.lastStatus = result.status;
        var changedJob = result.id !== this.jobId;
        if (changedJob && result.options) {
            var o = result.options;
            this.target.value = o.target || '';
            this.protocol.value = o.protocol || 'icmp';
            this.family.value = o.family || 'auto';
            this.device.value = o.device || '';
            this.provider.value = o.provider || 'NextTrace-API';
            this.maxHops.value = o.max_hops || 30;
            this.queries.value = o.queries || 3;
            this.timeout.value = o.timeout || 1000;
            this.port.value = o.port || 80;
            this.rdns.checked = o.rdns !== false;
        }
        this.jobId = result.id;
        this.setBusy(result.status === 'running');
        var labels = { idle: '准备就绪', running: '正在追踪', done: '追踪结束', stopped: '已停止', error: '追踪失败' };
        var elapsed = result.started ? Math.max(0, (result.finished || Math.floor(Date.now() / 1000)) - result.started) : 0;
        this.setMessage((result.error || labels[result.status] || result.status) + (result.id ? ' · ' + elapsed + ' 秒' : ''), result.status === 'error');
        this.diagnostics.textContent = (result.diagnostics || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') || '暂无日志';
        if (result.status === 'error') this.logPanel.open = true;
        if (changedJob || changedStatus || this.lastOutput !== (result.output || '')) {
            this.lastOutput = result.output || '';
            this.rows = trace.parse(this.lastOutput);
            this.renderRows();
            this.sendMap(changedJob);
        }
    },

    renderRows: function() {
        var self = this;
        this.body.replaceChildren();
        if (!this.rows.length) this.body.appendChild(el('tr', {}, el('td', { colspan: 8, 'class': 'ont-empty' },
            this.running ? '正在解析目标并探测路由，结果将在此逐跳出现…' : '输入目标，开始一次路由追踪')));
        this.rows.forEach(function(row) {
            var rtt = row.samples.map(function(v) { return v.toFixed(2); }).join(' / ') || '*';
            var cell = el('td', { 'class': 'ont-rtt' }, [el('span', {}, rtt)]);
            if (row.average != null) cell.appendChild(el('i', { style: 'width:' + Math.min(100, row.average / 3) + '%' }));
            var tr = el('tr', { 'data-key': row.key, tabindex: 0, 'class': row.ip === '*' ? 'ont-timeout' : '',
                click: function() { self.focusRow(row); }, keydown: function(event) { if (event.key === 'Enter') self.focusRow(row); } }, [
                el('td', { 'class': 'ont-hop' }, String(row.ttl)), el('td', { 'class': 'ont-ip' }, row.ip), cell,
                el('td', {}, row.location || '—'), el('td', {}, row.owner || '—'),
                el('td', { 'class': 'ont-asn' }, row.asn || '—'), el('td', { 'class': 'ont-host' }, row.hostname || '—'),
                el('td', { title: '本跳已返回探测记录中的未响应比例；中间节点可能限速，不等同于端到端丢包' }, row.loss + '%')
            ]);
            self.body.appendChild(tr);
        });
        var ttls = new Set(this.rows.map(function(r) { return r.ttl; }));
        this.summary.textContent = ttls.size + ' 跳 · ' + trace.points(this.rows).length + ' 个地图节点';
        this.exportButton.disabled = !this.rows.length;
    },

    highlight: function(key) {
        Array.prototype.forEach.call(this.body.children, function(row) {
            row.classList.toggle('ont-selected', row.getAttribute('data-key') === key);
            if (row.getAttribute('data-key') === key) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    },

    focusRow: function(row) {
        this.highlight(row.key);
        this.map.contentWindow.postMessage({ type: 'open-nexttrace-focus', key: row.key, point: row }, location.origin);
    },

    sendMap: function(fit) {
        if (this.map.contentWindow) this.map.contentWindow.postMessage({ type: 'open-nexttrace-update',
            points: trace.points(this.rows), fit: !!fit }, location.origin);
    },

    exportCSV: function() {
        var url = URL.createObjectURL(new Blob([trace.csv(this.rows)], { type: 'text/csv;charset=utf-8' }));
        var link = el('a', { href: url, download: 'open-nexttrace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv' });
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }
});
