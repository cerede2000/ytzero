import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useMotionReady, useReducedMotion } from "../motion";
import { colors } from "../theme";
import { LogoMark } from "./Logo";
import { useViewport } from "../viewport";

// Fixed trajectories keep the burst consistent across renders and devices.
const particles = [
  [-0.86, -0.55, 5], [-0.48, -0.78, 4], [0.08, -0.7, 3], [0.49, -0.43, 4],
  [-0.95, 0.12, 3], [-0.69, 0.46, 5], [-0.24, 0.76, 4], [0.26, 0.64, 3],
  [-1.25, -0.24, 3], [-0.35, -1.05, 3], [0.62, 0.2, 4], [-0.9, 0.86, 3],
] as const;
const impactTime = 0.48;
const phase = (time: number, start: number, end: number) => Math.max(0, Math.min(1, (time - start) / (end - start)));
const smooth = Easing.inOut(Easing.cubic);
const pulse = (time: number, start: number, peak: number, end: number) =>
  Easing.out(Easing.cubic)(phase(time, start, peak)) * (1 - smooth(phase(time, peak, end)));
const playPosition = (time: number) => time < 0.24
  ? -2.45 + 0.8 * Easing.out(Easing.cubic)(phase(time, 0.035, 0.24))
  : time < 0.33 ? -1.65 - 0.19 * smooth(phase(time, 0.24, 0.33))
  : time < impactTime
    ? -1.84 + 1.1 * Easing.in(Easing.cubic)(phase(time, 0.33, impactTime))
    : -0.74 * (1 - Easing.out(Easing.cubic)(phase(time, impactTime, 0.61)));
// The native clock stays linear; each property follows its own sampled easing
// curve. Dense samples avoid the velocity corners of sparse linear keyframes.
const times = Array.from({ length: 221 }, (_, index) => index / 220);
const sample = (value: (time: number) => number) => times.map(value);
const curves = {
  tileOpacity: sample((time) => Easing.out(Easing.quad)(phase(time, 0.01, 0.12))),
  playOpacity: sample((time) => smooth(phase(time, 0.035, 0.14))),
  entrance: sample((time) => Easing.out(Easing.cubic)(phase(time, 0.01, 0.27))),
  playEntrance: sample((time) => smooth(phase(time, 0.07, 0.25))),
  light: sample((time) => pulse(time, 0.015, 0.12, 0.34) * 0.3 + pulse(time, impactTime, 0.51, 0.76)),
  sheen: sample((time) => pulse(time, 0.02, 0.12, 0.3) * 0.65 + pulse(time, 0.76, 0.82, 0.95) * 0.4),
  sheenX: sample((time) => time < 0.5 ? -1 + 2 * smooth(phase(time, 0.02, 0.3)) : -1 + 2 * smooth(phase(time, 0.76, 0.95))),
  // Accelerate into contact, without braking before the collision. The tip
  // reaches the tile's left edge at impact; only then does the mark settle inside.
  tileX: sample((time) => 0.7 * (1 - Easing.out(Easing.cubic)(phase(time, 0.01, 0.25)))
    + 0.42 * (1 - Easing.in(Easing.quad)(phase(time, 0.32, impactTime)))),
  playX: sample(playPosition),
  anticipation: sample((time) => pulse(time, 0.24, 0.33, 0.4)),
  speed: sample((time) => pulse(time, 0.36, 0.46, 0.55)),
  trails: [0.018, 0.035, 0.052].map((lag) => sample((time) => playPosition(Math.max(0, time - lag)))),
  impact: sample((time) => pulse(time, impactTime, 0.51, 0.74)),
  wave: sample((time) => Easing.out(Easing.cubic)(phase(time, impactTime, 0.74))),
  waveOpacity: sample((time) => pulse(time, impactTime, 0.5, 0.74)),
  tileScale: sample((time) => 0.38 + 0.62 * Easing.out(Easing.back(1.35))(phase(time, 0.01, 0.28))),
  recoil: sample((time) => {
    const value = phase(time, impactTime, 0.88);
    return Math.exp(-5.5 * value) * Math.sin(value * Math.PI * 6) * (1 - smooth(phase(value, 0.7, 1)));
  }),
  burstOpacity: sample((time) => 0.95 * Easing.out(Easing.quad)(phase(time, impactTime, 0.5)) * (1 - smooth(phase(time, 0.56, 0.83)))),
  burstTravel: sample((time) => Easing.out(Easing.cubic)(phase(time, impactTime, 0.83))),
  burstDrop: sample((time) => Math.pow(phase(time, impactTime, 0.83), 2)),
  burstScale: sample((time) => Easing.out(Easing.quad)(phase(time, impactTime, 0.5)) * (1.4 - 1.1 * smooth(phase(time, 0.56, 0.83)))),
};

type Props = { ready: boolean; accessibilityLabel: string; onReveal: () => void; onFinish: () => void };

/** A single launch sequence; network restoration runs independently underneath. */
export function TvLaunchAnimation({ ready, accessibilityLabel, onReveal, onFinish }: Props) {
  const reduced = useReducedMotion();
  const motionReady = useMotionReady();
  const { width } = useViewport();
  const size = Math.min(260, Math.max(184, width * 0.145));
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [laidOut, setLaidOut] = useState(false);
  const [settled, setSettled] = useState(false);
  const callbacks = useRef({ onReveal, onFinish });
  callbacks.current = { onReveal, onFinish };

  useEffect(() => {
    if (!motionReady || !laidOut || settled) return;
    // If Reduce Motion changes during flight, settle immediately without a burst.
    if (reduced) { progress.setValue(1); setSettled(true); return; }
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    });
    // Let the native SVG layers and interpolation graph paint before starting
    // the clock; otherwise a cold launch can swallow the entrance's first frames.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => animation.start(({ finished }) => { if (finished) setSettled(true); }));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); animation.stop(); };
  }, [laidOut, motionReady, progress, reduced, settled]);

  useEffect(() => {
    if (!settled || !ready) return;
    // Mount the destination before fading the cover so there is no blank frame.
    let active = true;
    const animation = Animated.sequence([
      Animated.delay(reduced ? 100 : 260),
      Animated.timing(opacity, { toValue: 0, duration: reduced ? 160 : 300, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }),
    ]);
    callbacks.current.onReveal();
    animation.start(({ finished }) => { if (active && finished) callbacks.current.onFinish(); });
    return () => { active = false; animation.stop(); };
  }, [opacity, ready, reduced, settled]);

  const frame = (outputRange: number[]) => progress.interpolate({ inputRange: times, outputRange, extrapolate: "clamp" });
  return <Animated.View pointerEvents="none" accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}
    onLayout={() => setLaidOut(true)}
    style={[styles.cover, { opacity }]}>
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size,
      transform: [{ scale: frame(curves.impact.map((value, index) => 0.9 + curves.entrance[index]! * 0.1 + value * 0.1)) }],
    }}>
      {!reduced ? <>
        <Animated.View style={[styles.halo, { width: size * 3.5, height: size * 3.5, left: -size * 1.25, top: -size * 1.25,
          opacity: frame(curves.light.map((value) => value * 0.85)),
          transform: [{ scale: frame(curves.wave.map((value) => 0.6 + value * 0.5)) }],
        }]}>
          <Svg width={size * 3.5} height={size * 3.5} viewBox="0 0 100 100">
            <Defs><RadialGradient id="launchImpactGlow"><Stop offset="0" stopColor={colors.accent} stopOpacity="0.8" /><Stop offset="0.4" stopColor={colors.accent} stopOpacity="0.3" /><Stop offset="1" stopColor={colors.accent} stopOpacity="0" /></RadialGradient></Defs>
            <Rect width="100" height="100" fill="url(#launchImpactGlow)" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.wave, { width: size, height: size, borderRadius: size / 2, left: -size / 2,
          opacity: frame(curves.waveOpacity.map((value) => value * 0.5)),
          transform: [{ scale: frame(curves.wave.map((value) => 0.08 + value * 2.3)) }],
        }]} />
      </> : null}
      <Animated.View style={[StyleSheet.absoluteFill, {
        transform: [
          { translateX: frame(curves.recoil.map((value) => value * size * 0.3)) },
          { translateY: frame(curves.impact.map((value) => -value * size * 0.035)) },
          { rotate: progress.interpolate({ inputRange: times, outputRange: curves.recoil.map((value) => `${value * 14}deg`) }) },
          { scaleX: frame(curves.recoil.map((value) => 1 - value * 0.17)) },
          { scaleY: frame(curves.recoil.map((value) => 1 + value * 0.1)) },
        ],
      }]}>
        <Animated.View style={[StyleSheet.absoluteFill, {
          opacity: frame(curves.tileOpacity),
          transform: [{ perspective: 900 }, { translateX: frame(curves.tileX.map((value) => value * size)) }, { scale: frame(curves.tileScale) },
            { rotateY: progress.interpolate({ inputRange: times, outputRange: curves.entrance.map((value) => `${(1 - value) * -64}deg`) }) },
            { rotate: progress.interpolate({ inputRange: times, outputRange: curves.anticipation.map((value, index) => `${-value * 4 - (1 - curves.entrance[index]!) * 22}deg`) }) }],
        }]}><LogoMark size={size} layer="tile" />
          {!reduced ? <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size * 0.21875, overflow: "hidden", opacity: frame(curves.sheen) }]}>
            <Animated.View style={{ width: size, height: size, transform: [{ translateX: frame(curves.sheenX.map((value) => value * size)) }] }}>
              <Svg width={size} height={size} viewBox="0 0 100 100">
                <Defs><LinearGradient id="launchSheen" x1="0" y1="0" x2="1" y2="0.35"><Stop offset="0.2" stopColor="white" stopOpacity="0" /><Stop offset="0.5" stopColor="white" stopOpacity="0.65" /><Stop offset="0.8" stopColor="white" stopOpacity="0" /></LinearGradient></Defs>
                <Rect width="100" height="100" fill="url(#launchSheen)" />
              </Svg>
            </Animated.View>
          </Animated.View> : null}
        </Animated.View>
        {!reduced && curves.trails.map((trail, index) => <Animated.View key={index} style={[StyleSheet.absoluteFill, {
          opacity: frame(curves.speed.map((value) => value * [0.28, 0.14, 0.06][index]!)),
          transform: [{ translateX: frame(trail.map((value) => value * size)) }, { scaleX: 1.08 + index * 0.08 }, { scaleY: 0.96 - index * 0.05 }],
        }]}><LogoMark size={size} layer="play" /></Animated.View>)}
        <Animated.View style={[StyleSheet.absoluteFill, {
          opacity: frame(curves.playOpacity),
          transform: [{ translateX: frame(curves.playX.map((value) => value * size)) },
            { rotate: progress.interpolate({ inputRange: times, outputRange: curves.anticipation.map((value) => `${-value * 9}deg`) }) },
            { scaleX: frame(curves.speed.map((value, index) => 1 + value * 0.2 + (1 - curves.playEntrance[index]!) * 2.4)) },
            { scaleY: frame(curves.speed.map((value, index) => (0.025 + curves.playEntrance[index]! * 0.975) * (1 - value * 0.12))) }],
        }]}><LogoMark size={size} layer="play" /></Animated.View>
      </Animated.View>
      {!reduced && particles.map(([x, y, diameter], index) => <Animated.View key={index} style={[styles.particle, {
        width: index > 7 ? diameter * 3 : diameter, height: diameter, borderRadius: diameter / 2,
        left: 0, top: size * 0.5,
        backgroundColor: index % 3 === 0 ? colors.white : colors.accentStrong,
        opacity: frame(curves.burstOpacity),
        transform: [
          { translateX: frame(curves.burstTravel.map((value) => value * x * size)) },
          { translateY: frame(curves.burstTravel.map((value, index) => value * y * size + curves.burstDrop[index]! * 12)) },
          { scale: frame(curves.burstScale) },
          { rotate: `${Math.atan2(y, x) * 180 / Math.PI}deg` },
        ],
      }]} />)}
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, zIndex: 200, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  particle: { position: "absolute" },
  halo: { position: "absolute" },
  wave: { position: "absolute", top: 0, borderWidth: 1.5, borderColor: colors.accentStrong },
});
