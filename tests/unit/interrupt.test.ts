import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { InterruptHandler } from "../../src/lib/interrupt";

describe("InterruptHandler", () => {
  let handler: InterruptHandler;

  beforeEach(() => {
    handler = new InterruptHandler({ doublePressWindowMs: 100 });
  });

  afterEach(() => {
    handler.cleanup();
  });

  it("should show dialog on first SIGINT", () => {
    const onShowDialog = mock(() => {});
    handler.setOptions({ onShowDialog });
    
    // @ts-ignore - accessing private method for testing
    handler.handleSigint();
    
    expect(onShowDialog).toHaveBeenCalled();
    expect(handler.isDialogVisible()).toBe(true);
  });

  it("should force quit on double SIGINT within window", async () => {
    const onForceQuit = mock(() => {});
    handler.setOptions({ onForceQuit });
    
    // @ts-ignore
    handler.handleSigint();
    // @ts-ignore
    handler.handleSigint();
    
    expect(onForceQuit).toHaveBeenCalled();
  });

  it("should not force quit if SIGINTs are outside window", async () => {
    const onForceQuit = mock(() => {});
    handler.setOptions({ onForceQuit });
    
    // @ts-ignore
    handler.handleSigint();
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // @ts-ignore
    handler.handleSigint();
    
    expect(onForceQuit).not.toHaveBeenCalled();
  });

  it("should reset state on confirm", () => {
    const onConfirmed = mock(async () => {});
    handler.setOptions({ onConfirmed });
    
    // @ts-ignore
    handler.handleSigint();
    expect(handler.isDialogVisible()).toBe(true);
    
    handler.confirm();
    expect(handler.isDialogVisible()).toBe(false);
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("should reset state on cancel", () => {
    const onCancelled = mock(() => {});
    handler.setOptions({ onCancelled });
    
    // @ts-ignore
    handler.handleSigint();
    handler.cancel();
    
    expect(handler.isDialogVisible()).toBe(false);
    expect(onCancelled).toHaveBeenCalled();
  });
});
