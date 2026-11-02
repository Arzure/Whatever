/* ============================================================
 * 割草幸存者：8-bit 音效合成器
 * Web Audio API 纯合成，零素材依赖；含 Music/SFX 开关与高频音节流
 * ============================================================ */

// 高频事件节流（毫秒）：同一音效在间隔内不重复播放
const THROTTLE = { shoot: 90, pickup: 70, hit: 100, footstep: 180, heartbeat: 900 }

class SoundKit {
  constructor() {
    this.ctx = null
    this.sfxOn = true
    this.musicOn = true
    this.musicTimer = null
    this.lastT = {}
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  beep(freq, dur, type, vol, slide) {
    this.beepPan(freq, dur, type, vol, slide, 0)
  }

  // 带立体声声像的音效：pan ∈ [-1, 1]，负值左声道，正值右声道
  beepPan(freq, dur, type, vol, slide, pan) {
    const ctx = this.ensure()
    if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type || 'square'
    o.frequency.setValueAtTime(freq, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur)
    g.gain.setValueAtTime(vol || 0.06, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    let dest = ctx.destination
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t)
      g.connect(p)
      p.connect(ctx.destination)
    } else {
      g.connect(ctx.destination)
    }
    o.connect(g)
    o.start(t)
    o.stop(t + dur)
  }

  play(name) {
    if (!this.sfxOn) return
    const now = performance.now()
    const base = name.split('_')[0].replace(/[0-9]+$/, '')
    const min = THROTTLE[name] || THROTTLE[base] || 0
    if (min && now - (this.lastT[name] || 0) < min) return
    this.lastT[name] = now
    switch (name) {
      case 'shoot':
        this.beep(880, 0.06, 'square', 0.025, 440)
        break
      // 武器差异化射击音
      case 'shoot_pistol':
        this.beep(760, 0.05, 'square', 0.03, 380)
        break
      case 'shoot_smg':
        this.beep(980, 0.04, 'square', 0.022, 520)
        break
      case 'shoot_shotgun':
        this.beep(240, 0.12, 'sawtooth', 0.05, 70)
        break
      case 'shoot_railgun':
        this.beep(1400, 0.16, 'sawtooth', 0.045, 180)
        break
      case 'shoot_laser':
        this.beep(1600, 0.05, 'sine', 0.03, 1200)
        break
      case 'shoot_rocket':
        this.beep(180, 0.2, 'sawtooth', 0.055, 60)
        break
      case 'hit':
        this.beep(220, 0.05, 'sawtooth', 0.035, 110)
        break
      case 'kill':
        // 击杀确认音：短促上扬双音
        this.beep(660, 0.07, 'square', 0.05, 990)
        setTimeout(() => this.beep(1320, 0.1, 'square', 0.045), 60)
        break
      case 'pickup':
        this.beep(1320, 0.07, 'square', 0.045, 1760)
        break
      // 配件拾取音：档位越高越华丽
      case 'pickup0':
        this.beep(880, 0.06, 'square', 0.035, 990)
        break
      case 'pickup1':
        this.beep(990, 0.06, 'square', 0.04, 1100)
        setTimeout(() => this.beep(1320, 0.07, 'square', 0.04), 70)
        break
      case 'pickup2':
        this.beep(880, 0.07, 'square', 0.045, 1100)
        setTimeout(() => this.beep(1320, 0.07, 'square', 0.045), 80)
        setTimeout(() => this.beep(1760, 0.1, 'square', 0.045), 170)
        break
      case 'pickup3':
        // 至尊件：华丽琶音
        this.beep(660, 0.09, 'square', 0.05)
        setTimeout(() => this.beep(880, 0.09, 'square', 0.05), 90)
        setTimeout(() => this.beep(1100, 0.09, 'square', 0.05), 180)
        setTimeout(() => this.beep(1320, 0.09, 'square', 0.05), 270)
        setTimeout(() => this.beep(1760, 0.22, 'square', 0.05), 360)
        break
      case 'bossrage':
        // Boss 狂暴警报：双音警报循环
        this.beep(880, 0.16, 'sawtooth', 0.07, 660)
        setTimeout(() => this.beep(660, 0.16, 'sawtooth', 0.07, 880), 180)
        setTimeout(() => this.beep(880, 0.16, 'sawtooth', 0.07, 660), 380)
        setTimeout(() => this.beep(660, 0.24, 'sawtooth', 0.07, 440), 560)
        break
      case 'levelup':
        this.beep(660, 0.1, 'square', 0.06)
        setTimeout(() => this.beep(880, 0.1, 'square', 0.06), 90)
        setTimeout(() => this.beep(1320, 0.16, 'square', 0.06), 190)
        break
      case 'hurt':
        this.beep(160, 0.18, 'sawtooth', 0.1, 60)
        break
      case 'heartbeat':
        this.beep(75, 0.1, 'sine', 0.14, 48)
        setTimeout(() => this.beep(60, 0.08, 'sine', 0.1, 42), 180)
        break
      case 'footstep':
        this.beep(90, 0.04, 'triangle', 0.03, 60)
        break
      case 'hurtDir':
        this.beep(200, 0.12, 'sawtooth', 0.08, 90)
        break
      case 'boss':
        this.beep(110, 0.3, 'sawtooth', 0.1, 55)
        setTimeout(() => this.beep(110, 0.3, 'sawtooth', 0.1, 55), 320)
        break
      case 'bosskill':
        this.beep(523, 0.1, 'square', 0.07)
        setTimeout(() => this.beep(659, 0.1, 'square', 0.07), 100)
        setTimeout(() => this.beep(784, 0.1, 'square', 0.07), 200)
        setTimeout(() => this.beep(1047, 0.24, 'square', 0.07), 300)
        break
      case 'win':
        this.beep(523, 0.12, 'square', 0.07)
        setTimeout(() => this.beep(659, 0.12, 'square', 0.07), 130)
        setTimeout(() => this.beep(784, 0.12, 'square', 0.07), 260)
        setTimeout(() => this.beep(1047, 0.3, 'square', 0.07), 390)
        break
      case 'over':
        this.beep(330, 0.16, 'sawtooth', 0.08, 165)
        setTimeout(() => this.beep(220, 0.2, 'sawtooth', 0.08, 110), 170)
        setTimeout(() => this.beep(147, 0.4, 'sawtooth', 0.08, 73), 380)
        break
    }
  }

  // 命中音调随敌人剩余血量变化：ratio = 剩余HP/最大HP，血越少音调越高（200→700Hz）
  hitPitch(ratio) {
    if (!this.sfxOn) return
    const now = performance.now()
    if (now - (this.lastT['hitPitch'] || 0) < 60) return
    this.lastT['hitPitch'] = now
    const r = Math.max(0, Math.min(1, ratio))
    const f = 200 + (1 - r) * 500
    this.beep(f, 0.05, 'sawtooth', 0.03, f * 0.55)
  }

  // 动态音乐分层：0 平静 / 1 战斗 / 3 高潮（Boss/狂暴），叠加伴奏层
  setIntensity(v) { this.intensity = v }
  // 简易芯片音乐循环：三角波低音 + 方波主旋律
  startMusic() {
    if (this.musicTimer || !this.musicOn) return
    if (!this.ensure()) return
    const bass = [110, 0, 110, 0, 131, 0, 147, 0]
    const lead = [440, 523, 659, 523, 440, 392, 523, 659]
    const lead2 = [659, 784, 880, 784, 659, 587, 784, 880]
    let i = 0
    this.musicTimer = setInterval(() => {
      if (!this.musicOn) return
      const b = bass[i % 8]
      if (b) this.beep(b, 0.22, 'triangle', 0.05)
      this.beep(lead[i % 8], 0.18, 'square', 0.018)
      if (this.intensity >= 1) this.beep(lead2[i % 8], 0.1, 'square', 0.014)
      if (this.intensity >= 2) {
        this.beep((b || 110) * 2, 0.06, 'sawtooth', 0.02)
        if (i % 2 === 0) this.beep(220, 0.05, 'sawtooth', 0.016)
      }
      i++
    }, 260)
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer)
      this.musicTimer = null
    }
  }
}

export const sound = new SoundKit()
