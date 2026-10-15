# -*- coding: utf-8 -*-
"""推理杀跑局测试套件：名字池 / 终局立绘性别选取 / 结算合成。

用法：python3 server/tests/test_deduction.py
前置：服务已启动（pm2），.env 已配置 ACCESS_TOKEN 与 LLM API Key。
注意：会完整跑一局（多轮 LLM 调用，约 2-5 分钟，消耗少量 LLM 额度）。
"""
import base64
import json
import os
import re
import sys
import time
import urllib.request

BASE = 'http://localhost:3001'
ROOT = '/home/ubuntu/Whatever'
FEMALE = ('婉清', '苏晴', '孟瑶', '语嫣', '许诺')
OLD_NAMES = ('周舟', '何欢', '阿澈')


def load_env():
    env = open(ROOT + '/.env').read()
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
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def check(name, ok, detail=''):
    RESULTS.append((name, ok))
    print('%s %s %s' % ('PASS' if ok else 'FAIL', name, ('| ' + detail) if detail else ''))


def main():
    st, r = req('POST', '/api/auth/login', {'username': 'pt43661', 'password': 'test12345'})
    if st != 200:
        check('登录测试账号', False)
        return summary()
    token = r['token']
    check('登录测试账号', True)

    # —— 1. 开新对局：名字池检查 ——
    st, r = req('POST', '/api/games', {'mode': 'deduction', 'playerName': '测试法官'}, auth=token)
    if st not in (200, 201):
        check('创建对局', False, str(r)[:100])
        return summary()
    game_id = r.get('id')
    names = [p['name'] for p in (r.get('deduction') or {}).get('players', [])]
    check('创建对局', True, game_id)
    check('名字池:旧名字未出现', not any(n in OLD_NAMES for n in names), str(names))

    # —— 2. 游玩中限制 ——
    st, r = req('POST', '/api/games/%s/portrait' % game_id, {'name': names[0] if names else 'x'}, auth=token)
    check('游玩中立绘被拒(400)', st == 400)

    # —— 3. 推进到终局 ——
    phase = ''
    for i in range(15):
        st, r = req('GET', '/api/games/%s' % game_id, auth=token)
        state = r.get('state') or r
        ded = (state.get('deduction') or {}) if isinstance(state, dict) else {}
        phase = ded.get('phase', '')
        if phase in ('win', 'lose'):
            break
        if phase == 'adjudicate':
            req('POST', '/api/games/%s/adjudicate' % game_id, {}, auth=token)
        elif phase == 'day':
            req('POST', '/api/games/%s/action' % game_id, {'action': '听取发言'}, auth=token)
        time.sleep(1)
    check('推进到终局', phase in ('win', 'lose'), 'phase=%s' % phase)
    if phase not in ('win', 'lose'):
        return summary()

    # —— 4. 终局立绘：秒出 + 性别选取（内容级比对） ——
    players = ded.get('players') or []
    small_dir = ROOT + '/server/assets/portraits-small'
    index = {}
    for f in os.listdir(small_dir):
        if f.endswith('.png'):
            index[base64.b64encode(open(os.path.join(small_dir, f), 'rb').read()).decode()] = f
    all_ok = True
    for p in players[:4]:
        t0 = time.time()
        st, r = req('POST', '/api/games/%s/portrait' % game_id, {'name': p['name']}, auth=token)
        elapsed = time.time() - t0
        b64 = r.get('b64')
        if not b64 or elapsed > 1.0:
            all_ok = False
            continue
        hit = index.get(b64, '未匹配')
        expect_f = p['name'] in FEMALE
        actual_f = '女' in hit
        if expect_f != actual_f:
            all_ok = False
            print('    性别不符: %s -> %s' % (p['name'], hit))
    check('终局立绘(秒出+性别正确)', all_ok)

    # —— 5. 结算合成 ——
    t0 = time.time()
    st, r = req('POST', '/api/games/%s/ending-art' % game_id, auth=token)
    elapsed = time.time() - t0
    check('结算合成(<2s)', st == 200 and bool(r.get('b64')) and elapsed < 2.0, '%.2fs' % elapsed)

    # 清理测试对局
    req('DELETE', '/api/games/%s' % game_id, auth=token)
    return summary()


def summary():
    failed = [n for n, ok in RESULTS if not ok]
    print()
    print('=== 推理杀测试套件: %d/%d 通过 ===' % (len(RESULTS) - len(failed), len(RESULTS)))
    if failed:
        print('失败项:', failed)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
