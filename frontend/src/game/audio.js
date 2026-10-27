/* ============================================================
 * 割草幸存者：8-bit 音效合成器
 * Web Audio API 纯合成，零素材依赖；含 Music/SFX 开关与高频音节流
 * ============================================================ */

// 高频事件节流（毫秒）：同一音效在间隔内不重复播放
const THROTTLE = { shoot: 90, pickup: 70, hit: 100 }

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
    o.connect(g)
    g.connect(ctx.destination)
    o.start(t)
    o.stop(t + dur)
  }

  play(name) {
    if (!this.sfxOn) return
    const now = performance.now()
    const min = THROTTLE[name] || 0
    if (min && now - (this.lastT[name] || 0) < min) return
    this.lastT[name] = now
    switch (name) {
      case 'shoot':
        this.beep(880, 0.06, 'square', 0.025, 440)
        break
      case 'hit':
        this.beep(220, 0.05, 'sawtooth', 0.035, 110)
        break
      case 'pickup':
        this.beep(1320, 0.07, 'square', 0.045, 1760)
        break
      case 'levelup':
        this.beep(660, 0.1, 'square', 0.06)
        setTimeout(() => this.beep(880, 0.1, 'square', 0.06), 90)
        setTimeout(() => this.beep(1320, 0.16, 'square', 0.06), 190)
        break
      case 'hurt':
        this.beep(160, 0.18, 'sawtooth', 0.1, 60)
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

  // 简易芯片音乐循环：三角波低音 + 方波主旋律
  startMusic() {
    if (this.musicTimer || !this.musicOn) return
    if (!this.ensure()) return
    const bass = [110, 0, 110, 0, 131, 0, 147, 0]
    const lead = [440, 523, 659, 523, 440, 392, 523, 659]
    let i = 0
    this.musicTimer = setInterval(() => {
      if (!this.musicOn) return
      const b = bass[i % 8]
      if (b) this.beep(b, 0.22, 'triangle', 0.05)
      this.beep(lead[i % 8], 0.18, 'square', 0.018)
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
