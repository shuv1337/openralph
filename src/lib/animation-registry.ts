import { Timeline, createTimeline as createOpenTuiTimeline, type TimelineOptions } from "@opentui/core";

/**
 * Animation types available in the system.
 */
export type AnimationType = 
  | 'spin'           // Continuous rotation
  | 'pulse'          // Fade in/out
  | 'bounce'         // Up/down motion
  | 'typewriter'     // Character by character
  | 'progress'       // Progress bar fill
  | 'slide'          // Slide in from side
  | 'fade'           // Opacity fade
  | 'blink';         // On/off blinking

/**
 * Animation definition for registry.
 */
export interface AnimationDefinition {
  type: AnimationType;
  duration: number;       // ms for one cycle
  repeat: number | 'inf'; // Repeat count or infinite
  easing: string;         // CSS easing or custom
}

/**
 * Predefined animations.
 */
export const ANIMATIONS: Record<string, AnimationDefinition> = {
  // Spinner for idle/loading states
  spinner: {
    type: 'spin',
    duration: 800,
    repeat: 'inf',
    easing: 'linear',
  },
  
  // Pulse for active states
  pulse: {
    type: 'pulse',
    duration: 1500,
    repeat: 'inf',
    easing: 'inOutSine',
  },
  
  // Quick blink for errors
  blink: {
    type: 'blink',
    duration: 500,
    repeat: 3,
    easing: 'linear',
  },
  
  // Progress bar fill
  progress: {
    type: 'progress',
    duration: 2000,
    repeat: 'inf',
    easing: 'linear',
  },
  
  // Typewriter effect for text
  typewriter: {
    type: 'typewriter',
    duration: 50,  // per character
    repeat: 1,
    easing: 'linear',
  },
};

/**
 * Get animation definition by name.
 */
export function getAnimation(name: string): AnimationDefinition | null {
  return ANIMATIONS[name] || null;
}

/**
 * Create a timeline for compound animations.
 */
export function createTimeline(
  options: TimelineOptions = {}
): Timeline {
  return createOpenTuiTimeline(options);
}
