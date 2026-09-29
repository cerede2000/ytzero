import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useViewport } from "../viewport";

/**
 * A modal is a second root, and needs the canvas applied again.
 *
 * React Native mounts a `Modal` in its own native window on Android, outside
 * the view the root scales. Its contents are written in the same design points
 * as everything else, so without this they are drawn at the platform's own
 * scale — twice the size on a television that reports half the design width,
 * which is exactly what a sheet or a menu covering the screen looks like.
 *
 * It stays transparent: modals paint their own scrim.
 */
export function TvModalCanvas({ children }: { children: ReactNode }) {
  const canvas = useViewport();
  return (
    <View style={styles.screen}>
      <View style={[styles.canvas, { width: canvas.width, height: canvas.height, transform: [{ scale: canvas.scale }] }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  // No flex: the canvas is sized in design points, not by its parent.
  canvas: {},
});
