import { Component, createSignal, createEffect, onCleanup, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";

/**
 * Spinner animation component.
 */
export const Spinner: Component<{
  frames?: string[];
  duration?: number;
  color?: string;
  wrap?: boolean;
}> = (props) => {
  const frames = props.frames || ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const duration = props.duration || 120;
  
  const [frame, setFrame] = createSignal(0);
  const renderer = useRenderer();
  
  createEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
      renderer?.requestRender?.();
    }, duration);
    
    onCleanup(() => clearInterval(interval));
  });

  const content = () => frames[frame()];

  return (
    <Show when={props.wrap !== false} fallback={<span style={{ fg: props.color || 'text' }}>{content()}</span>}><text fg={props.color || 'text'}>{content()}</text></Show>
  );
};

/**
 * Progress bar component.
 */
export const ProgressBar: Component<{
  progress: number;  // 0-100
  width?: number;
  filledChar?: string;
  emptyChar?: string;
  filledColor?: string;
  emptyColor?: string;
  wrap?: boolean;
}> = (props) => {
  const width = props.width || 20;
  const filledChar = props.filledChar || '█';
  const emptyChar = props.emptyChar || '░';
  const filledColor = props.filledColor || 'success';
  const emptyColor = props.emptyColor || 'textMuted';

  const filledWidth = Math.floor((props.progress / 100) * width);
  const emptyWidth = width - filledWidth;

  const content = () => (<><span style={{ fg: filledColor }}>{filledChar.repeat(filledWidth)}</span><span style={{ fg: emptyColor }}>{emptyChar.repeat(emptyWidth)}</span><span> {props.progress.toFixed(0)}%</span></>);

  return (
    <Show when={props.wrap !== false} fallback={content()}><text>{content()}</text></Show>
  );
};

/**
 * Pulse animation component.
 */
export const Pulse: Component<{
  color?: string;
  children: any;
  wrap?: boolean;
}> = (props) => {
  const [opacity, setOpacity] = createSignal(1);
  const renderer = useRenderer();
  
  createEffect(() => {
    const interval = setInterval(() => {
      // Sine wave for smooth pulse
      const newOpacity = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 1000));
      setOpacity(newOpacity);
      renderer?.requestRender?.();
    }, 50);
    
    onCleanup(() => clearInterval(interval));
  });

  return (
    <Show when={props.wrap !== false} fallback={<span style={{ fg: props.color || 'text', opacity: opacity() }}>{props.children}</span>}><text style={{ fg: props.color || 'text', opacity: opacity() }}>{props.children}</text></Show>
  );
};

/**
 * Blinking text component.
 */
export const Blink: Component<{
  text: string;
  color?: string;
  interval?: number;
  wrap?: boolean;
}> = (props) => {
  const [visible, setVisible] = createSignal(true);
  const interval = props.interval || 500;
  const renderer = useRenderer();

  createEffect(() => {
    const id = setInterval(() => {
      setVisible((v) => !v);
      renderer?.requestRender?.();
    }, interval);
    
    onCleanup(() => clearInterval(id));
  });

  const content = () => (<Show when={visible()} fallback={<span>{" ".repeat(props.text.length)}</span>}><span style={{ fg: props.color || 'text' }}>{props.text}</span></Show>);

  return (
    <Show when={props.wrap !== false} fallback={content()}><text fg={props.color || 'text'}><Show when={visible()} fallback={" ".repeat(props.text.length)}>{props.text}</Show></text></Show>
  );
};

/**
 * Typewriter effect component for displaying text.
 */
export const Typewriter: Component<{
  text: string;
  speed?: number;
  color?: string;
  onComplete?: () => void;
  wrap?: boolean;
}> = (props) => {
  const speed = props.speed || 30;
  const [displayed, setDisplayed] = createSignal('');
  const renderer = useRenderer();
  
  createEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index < props.text.length) {
        setDisplayed(props.text.slice(0, index + 1));
        index++;
        renderer?.requestRender?.();
      } else {
        clearInterval(timer);
        props.onComplete?.();
      }
    }, speed);
    
    onCleanup(() => clearInterval(timer));
  });

  return (
    <Show when={props.wrap !== false} fallback={<span style={{ fg: props.color || 'text' }}>{displayed()}</span>}><text fg={props.color || 'text'}>{displayed()}</text></Show>
  );
};

/**
 * Marquee scrolling text component.
 */
export const Marquee: Component<{
  text: string;
  width?: number;
  speed?: number;
  color?: string;
  wrap?: boolean;
}> = (props) => {
  const width = props.width || 40;
  const speed = props.speed || 100;
  const [offset, setOffset] = createSignal(0);
  const renderer = useRenderer();

  const paddedText = createSignal('  ' + props.text + '  ')[0];

  createEffect(() => {
    const timer = setInterval(() => {
      setOffset((o) => (o + 1) % paddedText().length);
      renderer?.requestRender?.();
    }, speed);
    
    onCleanup(() => clearInterval(timer));
  });

  const visibleText = () => {
    const t = paddedText();
    let res = t.slice(offset());
    if (res.length < width) {
      res += t.slice(0, width - res.length);
    }
    return res.slice(0, width);
  };

  return (
    <Show when={props.wrap !== false} fallback={<span style={{ fg: props.color || 'text' }}>{visibleText()}</span>}><text fg={props.color || 'text'}>{visibleText()}</text></Show>
  );
};
