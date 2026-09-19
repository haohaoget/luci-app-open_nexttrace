/* Development-only LuCI adapter. Production resources are loaded unmodified. */
(async function() {
    'use strict';
    var root = '../../luci-app-open_nexttrace/htdocs/luci-static/resources/';
    var fixture = [
        '1|192.168.1.1|router.lan|0.42|||||||0|0',
        '1|192.168.1.1|router.lan|0.38|||||||0|0',
        '2|100.64.0.1||2.61|||||||0|0',
        '3|203.0.113.1|shanghai.example|8.22|4134|中国|上海|上海||China Telecom|31.23|121.47',
        '3|203.0.113.1|shanghai.example|8.71|4134|中国|上海|上海||China Telecom|31.23|121.47',
        '4|*||||||',
        '5|203.0.113.5|tokyo.example|47.81|2914|日本||东京||NTT Communications|35.68|139.69',
        '6|203.0.113.6|los-angeles.example|148.62|174|美国|加利福尼亚州|洛杉矶||Cogent Communications|34.05|-118.24',
        '6|203.0.113.6|los-angeles.example|152.20|174|美国|加利福尼亚州|洛杉矶||Cogent Communications|34.05|-118.24',
        '7|203.0.113.7|dallas.example|173.10|174|美国|得克萨斯州|达拉斯||Cogent Communications|32.78|-96.80',
        '8|203.0.113.8|new-york.example|199.51|13335|美国|纽约州|纽约||Cloudflare|40.71|-74.01'
    ];
    var job = {status: 'idle'}, step = 0, counter = 0;
    var network = [
        {name:'wan', device:'pppoe-wan', up:true, wan:true, ipv4:true},
        {name:'wan6', device:'pppoe-wan', up:true, wan:true, ipv6:true},
        {name:'wan2', device:'eth1', up:true, wan:true, ipv4:true},
        {name:'vpn', device:'wg0', up:true, wan:false, ipv4:true},
        {name:'lan', device:'br-lan', up:true, wan:false, ipv4:true}
    ];
    var L = {resource: function(p) {return root + p;}, hasViewPermission: function() {return true;}};
    function E(tag, attributes, children) {
        var node = document.createElement(tag);
        Object.entries(attributes || {}).forEach(function(entry) {
            var key = entry[0], value = entry[1];
            if (value == null) return;
            if (typeof value === 'function') node.addEventListener(key, value);
            else node.setAttribute(key, value);
        });
        // Mirror LuCI's distinction: scalar strings are HTML, array strings
        // are text nodes. Production code must explicitly choose text nodes.
        if (typeof children === 'string') { node.innerHTML = children; return node; }
        (Array.isArray(children) ? children : [children]).forEach(function(child) {
            if (child != null) node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
        });
        return node;
    }
    var rpc = {declare: function(config) {return async function() {
        var input = {};
        (config.params || []).forEach((key, index) => { input[key] = arguments[index]; });
        if (config.method === 'info') return {available:true, version:'v1.7.3', interfaces:network};
        if (config.method === 'start') {
            step = 0;
            job = {id:'demo-' + (++counter), status:'running', started:Math.floor(Date.now()/1000), options:input, output:''};
        }
        if (config.method === 'stop') { job.status='stopped'; job.finished=Math.floor(Date.now()/1000); return {success:true}; }
        if (config.method === 'status' && job.status === 'running') {
            step = Math.min(step + 2, fixture.length);
            job.output = fixture.slice(0, step).join('\n') + '\n';
            if (step === fixture.length) {job.status='done'; job.finished=Math.floor(Date.now()/1000);}
        }
        return Object.assign({}, job);
    };}};
    var timers = new Map(), poll = {
        add: function(fn, seconds) {timers.set(fn,setInterval(fn,seconds*1000));},
        remove: function(fn) {clearInterval(timers.get(fn));}
    };
    var baseclass = {extend: x => x};
    var trace = new Function('baseclass', await (await fetch(root+'open_nexttrace/trace.js')).text())(baseclass);
    var view = new Function('view','rpc','poll','trace','L','E',await (await fetch(root+'view/open_nexttrace/main.js')).text())(baseclass,rpc,poll,trace,L,E);
    document.getElementById('view').appendChild(view.render(await view.load()));
}());
