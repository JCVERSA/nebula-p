/**
 * 9.18jj (A) — décrochage honnête des appels : rejet propre + guidage
 * talkie-walkie (note vocale → réponse en voix), cooldown, sourdine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleIncomingCalls, __resetCallGateForTests } from "../src/bot/services/callGate.js";

vi.mock("../src/bot/userDirectory.js", () => ({
  isMutedUser: vi.fn(() => false),
}));
import { isMutedUser } from "../src/bot/userDirectory.js";

const mMuted = vi.mocked(isMutedUser);

function mkSock() {
  return {
    rejectCall: vi.fn(async (_id: string, _from: string) => {}),
    sendMessage: vi.fn(async (_to: string, _payload: { text: string }) => ({})),
  };
}

const OFFER = { id: "call-1", from: "237999111222@s.whatsapp.net", status: "offer" };

beforeEach(() => {
  vi.clearAllMocks();
  mMuted.mockReturnValue(false);
  __resetCallGateForTests();
});

describe("9.18jj (A) — handleIncomingCalls", () => {
  it("offre 1:1 → rejet + guidage note vocale avec la commande .on", async () => {
    const sock = mkSock();
    await handleIncomingCalls(sock, [OFFER], { prefix: "." }, 1000);
    expect(sock.rejectCall).toHaveBeenCalledWith("call-1", "237999111222@s.whatsapp.net");
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const text = sock.sendMessage.mock.calls[0]![1].text;
    expect(text).toContain("Je ne peux pas décrocher");
    expect(text).toContain("note vocale");
    expect(text).toContain(".on");
  });

  it("deuxième appel dans le cooldown → rejet SANS deuxième message", async () => {
    const sock = mkSock();
    await handleIncomingCalls(sock, [OFFER], {}, 1000);
    await handleIncomingCalls(sock, [{ ...OFFER, id: "call-2" }], {}, 60_000);
    expect(sock.rejectCall).toHaveBeenCalledTimes(2);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("après le cooldown (10 min) → guidage à nouveau", async () => {
    const sock = mkSock();
    await handleIncomingCalls(sock, [OFFER], {}, 1000);
    await handleIncomingCalls(sock, [{ ...OFFER, id: "call-2" }], {}, 1000 + 11 * 60_000);
    expect(sock.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("utilisateur en sourdine → rejet SANS aucun message", async () => {
    mMuted.mockReturnValue(true);
    const sock = mkSock();
    await handleIncomingCalls(sock, [OFFER], {}, 1000);
    expect(sock.rejectCall).toHaveBeenCalledTimes(1);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("statut non-offer et appels groupe → totalement ignorés", async () => {
    const sock = mkSock();
    await handleIncomingCalls(sock, [
      { ...OFFER, status: "accept" },
      { ...OFFER, from: "123-456@g.us" },
    ], {}, 1000);
    expect(sock.rejectCall).not.toHaveBeenCalled();
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("rejet en échec → pas de crash, guidage quand même", async () => {
    const sock = mkSock();
    sock.rejectCall = vi.fn(async () => { throw new Error("boom"); });
    await handleIncomingCalls(sock, [OFFER], {}, 1000);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
  });
});
