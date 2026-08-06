// FaceTalk · WebRTC glare 决策（双方同时发起 offer 时，谁 roll back）
// 纯函数，浏览器和 Node 共用，便于单测
// RFC 5245: 字典序大的一方保留发起方，小的一方 roll back 改应答
// 双方 ID 缺失时默认应答对方（更稳，错过总比冲突好）
function decideGlare(myId, peerId) {
  if (!myId || !peerId) return 'roll-back-self';
  return peerId < myId ? 'ignore-self' : 'roll-back-self';
}
if (typeof module !== 'undefined') module.exports = { decideGlare };
