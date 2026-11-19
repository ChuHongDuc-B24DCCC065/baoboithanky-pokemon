/** Sender/recipient authorization gate for an isolated local Socket.IO PoC. */
class SocketGate {
  constructor(authorityStore, { ackTimeoutMs = 500 } = {}) { this.authorityStore = authorityStore; this.socketIdentities = new Map(); this.ackTimeoutMs = ackTimeoutMs; }
  attachIdentity(socket, uid, sessionHash, sessionGeneration) { const identity = { uid, sessionHash, sessionGeneration }; this.socketIdentities.set(socket.id, { socket, identity }); socket.authIdentity = identity; }
  removeIdentity(socketOrId) {
    const id = typeof socketOrId === "string" ? socketOrId : socketOrId && socketOrId.id;
    const entry = this.socketIdentities.get(id);
    if (entry && entry.socket) delete entry.socket.authIdentity;
    if (socketOrId && typeof socketOrId === "object") delete socketOrId.authIdentity;
    return this.socketIdentities.delete(id);
  }
  _authorize(socket) {
    if (!socket || socket.connected === false) return { allowed: false, code: "SOCKET_DISCONNECTED" };
    const entry = this.socketIdentities.get(socket.id);
    if (!entry || entry.socket !== socket) return { allowed: false, code: "UNREGISTERED_SOCKET" };
    return this.authorityStore.evaluateAuthorization(entry.identity.uid, entry.identity.sessionHash);
  }
  authorizeSender(socket) { return this._authorize(socket); }
  authorizeRecipient(socket) { return this._authorize(socket); }
  async targetedEmit(candidateSockets, eventName, payload) {
    const allowList = [], deniedList = [];
    for (const socket of candidateSockets) { const decision = this.authorizeRecipient(socket); if (decision.allowed) allowList.push(socket); else deniedList.push({ socketId: socket && socket.id, code: decision.code }); }
    const results = await Promise.all(allowList.map(socket => new Promise(resolve => {
      let done = false; const finish = ok => { if (!done) { done = true; clearTimeout(timer); resolve({ socketId: socket.id, delivered: ok }); } };
      const timer = setTimeout(() => finish(false), this.ackTimeoutMs);
      try { socket.emit(eventName, payload, () => finish(true)); } catch (_) { finish(false); }
    })));
    const delivered = results.filter(x => x.delivered).length;
    return { totalCandidates: candidateSockets.length, admittedCount: allowList.length, deniedCount: deniedList.length, deliveredCount: delivered, deliveryFailureCount: results.length - delivered, allowListSocketIds: allowList.map(s => s.id), deniedList };
  }
  async handleGameplayEvent(senderSocket, eventName, payload, recipients, processEvent = () => {}) {
    const sender = this.authorizeSender(senderSocket);
    if (!sender.allowed) return { accepted: false, senderDecision: sender, delivery: null };
    await processEvent(payload);
    return { accepted: true, senderDecision: sender, delivery: await this.targetedEmit(recipients, eventName, payload) };
  }
}
module.exports = { SocketGate };
