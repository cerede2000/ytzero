import { useCallback, useMemo, type ReactElement } from "react";
import {
  FlatList,
  StyleSheet,
  type ListRenderItem,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { TvScrollEdges } from "./TvScrollEdges";
import { useViewport } from "../viewport";

type Props<Item> = {
  data: Item[];
  estimatedItemExtent?: number;
  initialNumToRender?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  edgeEffect?: boolean;
  footer?: ReactElement | null;
  initialScrollIndex?: number;
  itemExtent?: number;
  keyExtractor: (item: Item, index: number) => string;
  persistentRenderIndices?: number[];
  renderItem: ListRenderItem<Item>;
  style?: StyleProp<ViewStyle>;
  wrapperStyle?: StyleProp<ViewStyle>;
};

const noPersistentRenderIndices: number[] = [];

/**
 * Shared TV carousel primitive. FlatList keeps only the nearby cards mounted,
 * while the first item stays available as a stable D-pad focus destination.
 */
export function TvHorizontalList<Item>({
  data,
  estimatedItemExtent,
  initialNumToRender,
  contentContainerStyle,
  edgeEffect = true,
  footer,
  initialScrollIndex,
  itemExtent,
  keyExtractor,
  persistentRenderIndices = noPersistentRenderIndices,
  renderItem,
  style,
  wrapperStyle,
}: Props<Item>) {
  const { width } = useViewport();
  const initialCount = useMemo(() => {
    const requested = initialNumToRender
      ?? (estimatedItemExtent ? Math.ceil(width / estimatedItemExtent) + 2 : 8);
    return Math.max(1, Math.min(data.length || 1, requested));
  }, [data.length, estimatedItemExtent, initialNumToRender, width]);
  const additionalRenderRegions = useMemo(() => {
    if (data.length === 0) return undefined;
    return [...new Set([0, ...persistentRenderIndices])]
      .filter((index) => index >= 0 && index < data.length)
      .map((index) => ({ first: index, last: index }));
  }, [data.length, persistentRenderIndices]);
  const getItemLayout = useCallback((_: ArrayLike<Item> | null | undefined, index: number) => ({
    index,
    length: itemExtent ?? 0,
    offset: (itemExtent ?? 0) * index,
  }), [itemExtent]);

  return (
    <TvScrollEdges enabled={edgeEffect} style={[styles.wrapper, wrapperStyle]}>
      <FlatList
        horizontal
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListFooterComponent={footer}
        initialScrollIndex={initialScrollIndex}
        getItemLayout={itemExtent ? getItemLayout : undefined}
        style={style}
        contentContainerStyle={contentContainerStyle}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        initialNumToRender={initialCount}
        maxToRenderPerBatch={Math.max(3, Math.min(8, initialCount))}
        updateCellsBatchingPeriod={48}
        windowSize={5}
        removeClippedSubviews={false}
        additionalRenderRegions={additionalRenderRegions}
      />
    </TvScrollEdges>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: "100%", overflow: "hidden" },
});
