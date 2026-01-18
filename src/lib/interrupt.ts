export interface InterruptOptions {
  doublePressWindowMs?: number;
  onConfirmed?: () => Promise<void>;
  onCancelled?: () => void;
  onShowDialog?: () => void;
  onHideDialog?: () => void;
  onForceQuit?: () => void;
}

export class InterruptHandler {
  private lastSigintTime: number = 0;
  private options: InterruptOptions;
  private dialogVisible: boolean = false;
  
  constructor(options: InterruptOptions = {}) {
    this.options = {
      doublePressWindowMs: 500,
      ...options,
    };
  }
  
  setup(): void {
    process.on('SIGINT', this.handleSigint.bind(this));
    process.on('SIGTERM', this.handleSigint.bind(this));
  }
  
  cleanup(): void {
    process.off('SIGINT', this.handleSigint.bind(this));
    process.off('SIGTERM', this.handleSigint.bind(this));
  }
  
  private handleSigint(): void {
    const now = Date.now();
    const timeSinceLast = now - this.lastSigintTime;
    this.lastSigintTime = now;
    
    if (timeSinceLast < this.options.doublePressWindowMs!) {
      // Double press - force quit
      if (this.options.onForceQuit) {
        this.options.onForceQuit();
      } else {
        process.exit(1);
      }
    } else {
      // Single press - show confirmation dialog
      if (this.options.onShowDialog) {
        this.options.onShowDialog();
      }
      this.dialogVisible = true;
    }
  }
  
  confirm(): void {
    if (this.options.onHideDialog) {
      this.options.onHideDialog();
    }
    this.dialogVisible = false;
    this.lastSigintTime = 0;
    
    if (this.options.onConfirmed) {
      this.options.onConfirmed();
    }
  }
  
  cancel(): void {
    if (this.options.onHideDialog) {
      this.options.onHideDialog();
    }
    this.dialogVisible = false;
    this.lastSigintTime = 0;
    
    if (this.options.onCancelled) {
      this.options.onCancelled();
    }
  }
  
  isDialogVisible(): boolean {
    return this.dialogVisible;
  }
  
  setOptions(options: Partial<InterruptOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }
}
