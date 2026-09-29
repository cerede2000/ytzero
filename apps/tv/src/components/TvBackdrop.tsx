import { useEffect, useId, useRef, useState } from "react";
import { Animated, Image, StyleSheet, View, type ImageURISource, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../theme";
import { useIncreasedContrast, useReducedMotion, useReducedTransparency } from "../motion";
import { TvGradientMask } from "./TvGradientMask";
import { imageSourceWithHeaders } from "../imageSource";

/** Artwork stays behind the reading/focus plane; gradients darken the text area. */
export function TvBackdrop({ source, fallbackSource, style }: { source: ImageURISource; fallbackSource?: ImageURISource; style?: StyleProp<ViewStyle> }) {
  const id = useId().replace(/:/g, "");
  const contrast = useIncreasedContrast();
  const [failedUri, setFailedUri] = useState<string | undefined>();
  return (
    <View pointerEvents="none" accessible={false} style={[styles.backdrop, style]}>
      <BackdropArtwork source={failedUri === source.uri && fallbackSource ? fallbackSource : source}
        blurSource={fallbackSource ?? source}
        onError={() => setFailedUri(source.uri)} />
      {contrast ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)" }]} /> : null}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.background} stopOpacity="0.94" />
            <Stop offset="0.4" stopColor={colors.background} stopOpacity="0.7" />
            <Stop offset="0.75" stopColor={colors.background} stopOpacity="0.08" />
          </LinearGradient>
          <LinearGradient id={`${id}-bottom`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.background} stopOpacity="0.1" />
            <Stop offset="0.45" stopColor={colors.background} stopOpacity="0.08" />
            <Stop offset="0.8" stopColor={colors.background} stopOpacity="0.62" />
            <Stop offset="1" stopColor={colors.background} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id}-side)`} />
        <Rect width="100%" height="100%" fill={`url(#${id}-bottom)`} />
      </Svg>
    </View>
  );
}

/** Only artwork fades; the glass controls never inherit animated opacity. */
type Artwork = { source: ImageURISource; blurSource: ImageURISource };

function BackdropArtwork({ source, blurSource, onError }: { source: ImageURISource; blurSource: ImageURISource; onError: () => void }) {
  const reduced = useReducedMotion();
  const [displayed, setDisplayed] = useState<Artwork | null>(null);
  const incoming = source.uri !== displayed?.source.uri || blurSource.uri !== displayed?.blurSource.uri;
  return <>
    {displayed ? <ArtworkLayer key={`${displayed.source.uri}:${displayed.blurSource.uri}`} artwork={displayed} reduced={reduced} /> : null}
    {incoming ? <ArtworkLayer key={`${source.uri}:${blurSource.uri}`} artwork={{ source, blurSource }} reduced={reduced}
      onError={onError} onReady={() => setDisplayed({ source, blurSource })} /> : null}
  </>;
}

function ArtworkImage({ source, blurSource, onLoad, onError }: { source: ImageURISource; blurSource: ImageURISource; onLoad?: () => void; onError?: () => void }) {
  const opaque = useReducedTransparency();
  return <>
    <Image source={imageSourceWithHeaders(source)} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={onLoad} onError={onError} />
    {!opaque ? <TvGradientMask style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
      <Image source={imageSourceWithHeaders(blurSource)} style={styles.blurArtwork} resizeMode="cover" blurRadius={16} />
    </TvGradientMask> : null}
  </>;
}

function ArtworkLayer({ artwork, reduced, onError, onReady }: { artwork: Artwork; reduced: boolean; onError?: () => void; onReady?: () => void }) {
  const opacity = useRef(new Animated.Value(onReady ? 0 : 1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const latestReady = useRef(onReady);
  latestReady.current = onReady;
  useEffect(() => () => animation.current?.stop(), []);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
    <ArtworkImage source={artwork.source} blurSource={artwork.blurSource} onError={onError} onLoad={() => {
      if (!latestReady.current) { opacity.setValue(1); return; }
      animation.current?.stop();
      animation.current = Animated.timing(opacity, { toValue: 1, duration: reduced ? 0 : 650, useNativeDriver: true, isInteraction: false });
      animation.current.start(({ finished }) => { if (finished) latestReady.current?.(); });
    }} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden", backgroundColor: colors.background },
  // The blur is intentionally preserved, but it is rasterized at half size
  // and enlarged. A soft image does not need a full-resolution offscreen pass.
  blurArtwork: { position: "absolute", width: "50%", height: "50%", left: "25%", top: "25%", transform: [{ scale: 2 }] },
});
