# -*- coding: utf-8 -*-
"""绘图接口测试套件：选项查询 / 参数校验 / 历史与提示词链路。

用法：python3 server/tests/test_draw.py
前置：服务已启动（pm2），.env 已配置 ACCESS_TOKEN 与图像 API Key。
注意：参数校验类测试不消耗生图额度；链路验证会生成一张 512x512 小图（低成本）。
"""
import json
import re
import sys
import urllib.request

BASE = 'http://localhost:3001'


def load_env():
    env = open('/home/ubuntu/Whatever/.env').read()
    return re.search(r'^ACCESS_TOKEN=(.*)$', env, re.M).group(1).strip()


ACCESS = load_env()
RESULTS = []


def req(method, path, body=None, auth=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    r.add_header('X-Access-Token', ACCESS)
    if auth:
        r.add_header('Authorization', 'Bearer ' + auth)
    try:
        with urllib.request.urlopen(r, timeout=200) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw.decode())
            except Exception:
                return resp.status, {'binary': len(raw)}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def check(name, ok, detail=''):
    RESULTS.append((name, ok))
    print('%s %s %s' % ('PASS' if ok else 'FAIL', name, ('| ' + detail) if detail else ''))


def main():
    # —— 1. 选项查询（不消耗额度） ——
    st, r = req('GET', '/api/draw/options')
    check('选项查询', st == 200 and r.get('enabled') is True
          and len(r.get('models', [])) >= 2 and 'auto' in r.get('sizes', [])
          and 'webp' in r.get('outputFormats', []),
          '模型 %s' % [m['id'] for m in r.get('models', [])])

    # —— 2. 参数校验（不消耗额度，全部应 400 拦截） ——
    cases = [
        ('空提示词', '/api/draw/generate', {'model': 'sensenova-u1.5-fast', 'prompt': ''}),
        ('非法模型名', '/api/draw/generate', {'model': 'bad model; rm', 'prompt': '测试'}),
        ('非法尺寸(非32倍数)', '/api/draw/generate', {'model': 'sensenova-u1.5-fast', 'prompt': '测试', 'size': '1000x1000'}),
        ('超范围尺寸', '/api/draw/generate', {'model': 'sensenova-u1.5-fast', 'prompt': '测试', 'size': '5120x5120'}),
        ('编辑无参考图', '/api/draw/edit', {'model': 'sensenova-u1.5-fast', 'prompt': '测试', 'images': []}),
        ('参考图格式非法', '/api/draw/edit', {'model': 'sensenova-u1.5-fast', 'prompt': '测试', 'images': ['not-a-url']}),
    ]
    for name, path, body in cases:
        st, r = req('POST', path, body)
        check('校验:' + name, st == 400 and bool(r.get('error')))

    # —— 3. 历史与提示词链路（需登录；生成一张 512 小图验证） ——
    st, r = req('POST', '/api/auth/login', {'username': 'pt43661', 'password': 'test12345'})
    if st != 200:
        check('登录测试账号', False, '登录失败，跳过链路测试')
        return summary()
    token = r['token']
    check('登录测试账号', True)

    st, r = req('POST', '/api/draw/generate', {
        'model': 'sensenova-u1.5-fast', 'prompt': '测试套件验证图（可删除）',
        'size': '512x512', 'outputFormat': 'png', 'watermark': False, 'promptExtend': False,
    }, auth=token)
    check('生成入库(512x512)', st == 200 and bool(r.get('b64s')))

    st, h = req('GET', '/api/draw/history', auth=token)
    rows = h.get('rows', [])
    check('历史查询', st == 200 and len(rows) >= 1 and h.get('ttlHours') == 24)
    if rows:
        row = rows[0]
        check('历史字段完整', bool(row.get('mode')) and bool(row.get('model')) and bool(row.get('url')))
        st2, r2 = req('GET', row['url'], auth=token)
        check('图片文件访问', st2 == 200 and r2.get('binary', 0) > 1000)
        st3, d = req('DELETE', '/api/draw/history/%s' % row['id'], auth=token)
        check('历史删除', st3 == 200 and d.get('ok'))

    st, p = req('GET', '/api/draw/prompts', auth=token)
    prompts = p.get('rows', [])
    check('提示词入库', any('测试套件验证图' in x['prompt'] for x in prompts))
    # 清理验证数据
    for x in prompts:
        if '测试套件验证图' in x['prompt']:
            req('DELETE', '/api/draw/prompts/%s' % x['id'], auth=token)
    return summary()


def summary():
    failed = [n for n, ok in RESULTS if not ok]
    print()
    print('=== 绘图测试套件: %d/%d 通过 ===' % (len(RESULTS) - len(failed), len(RESULTS)))
    if failed:
        print('失败项:', failed)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
