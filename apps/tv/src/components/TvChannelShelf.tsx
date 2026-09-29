import { forwardRef, useCallback, type Ref } from "react";
import { Image, StyleSheet, Text, TVFocusGuideView, View, type FocusDestination, type ListRenderItemInfo } from "react-native";
import type { Channel } from "../types";
import { colors, typography } from "../theme";
import { TvHorizontalList } from "./TvHorizontalList";
import { TvControlSurface } from "./TvSurface";
import { TvPressable } from "./TvPressable";
import { TvLiveBadge } from "./TvLiveBadge";
import { imageSourceWithHeaders } from "../imageSource";

type Props = {
  title: string;
  liveLabel: string;
  channels: Channel[];
  firstItemRef?: Ref<View>;
  nextFocusUp?: FocusDestination;
  nextFocusDown?: FocusDestination;
  thumbnailSource: (thumbnail: string) => { uri: string; headers?: Record<string, string> };
  onOpen: (channel: Channel) => void;
};
const channelKey = (channel: Channel) => channel.channel_id;

export function TvChannelShelf({ title, liveLabel, channels, firstItemRef, nextFocusUp, nextFocusDown, thumbnailSource, onOpen }: Props) {
  const renderChannel = useCallback(({ item: channel, index }: ListRenderItemInfo<Channel>) => (
    <ChannelItem
      ref={index === 0 ? firstItemRef : undefined}
      channel={channel}
      liveLabel={liveLabel}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}

      source={thumbnailSource(channel.thumbnail)}
      onPress={() => onOpen(channel)}
    />
  ), [firstItemRef, liveLabel, nextFocusDown, nextFocusUp, onOpen, thumbnailSource]);
  if (channels.length === 0) return null;
  return (
    <TVFocusGuideView autoFocus style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      <TvHorizontalList
        data={channels}
        estimatedItemExtent={220}
        itemExtent={220}
        contentContainerStyle={styles.row}
        keyExtractor={channelKey}
        renderItem={renderChannel}
      />
    </TVFocusGuideView>
  );
}

const ChannelItem = forwardRef<View, {
  channel: Channel;
  liveLabel: string;
  nextFocusUp?: FocusDestination;
  nextFocusDown?: FocusDestination;
  source: { uri: string; headers?: Record<string, string> };
  onPress: () => void;
}>(function ChannelItem({ channel, liveLabel, nextFocusUp, nextFocusDown, source, onPress }, ref) {
  return (
    <TvPressable deferPress focusScale={1.045}
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={channel.is_live === 1 ? `${channel.title}. ${liveLabel}` : channel.title}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      onPress={onPress}
      style={({ focused, pressed }) => [styles.item, focused && styles.itemFocused, pressed && styles.itemPressed]}
    >
      {({ focused }) => <>
        <TvControlSurface radius={24} focused={focused} filled={false} />
        <View style={styles.avatarWrap}>
          {source.uri ? <Image source={imageSourceWithHeaders(source)} style={styles.avatar} resizeMode="cover" /> : <View style={[styles.avatar, styles.placeholder]} />}
          {channel.is_live === 1 && <TvLiveBadge label={liveLabel} placement="avatar" />}
        </View>
        <Text numberOfLines={2} style={[styles.name, focused && styles.nameFocused]}>{channel.title}</Text>
        {channel.subscriber_count ? <Text numberOfLines={1} style={[styles.subscribers, focused && styles.subscribersFocused]}>{channel.subscriber_count}</Text> : null}
      </>}
    </TvPressable>
  );
});

const styles = StyleSheet.create({
  section: { width: "100%", marginBottom: 28 },
  heading: { color: colors.text, fontSize: 27, lineHeight: 34, fontWeight: "700", marginBottom: 17, marginHorizontal: 20 },
  row: { gap: 20, paddingHorizontal: 20, paddingTop: 7, paddingBottom: 9 },
  item: { width: 200, minHeight: 240, alignItems: "center", paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, borderRadius: 24, backgroundColor: "transparent" },
  itemFocused: { shadowColor: colors.black, shadowOpacity: 0.6, shadowRadius: 22, shadowOffset: { width: 0, height: 12 } },
  itemPressed: { opacity: 0.76 },
  avatarWrap: { width: 112, height: 112 },
  avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.surfaceRaised },
  placeholder: { backgroundColor: colors.surfaceRaised },
  name: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", textAlign: "center", marginTop: 12 },
  nameFocused: { color: colors.text },
  subscribers: { color: colors.textMuted, fontSize: typography.caption.fontSize, marginTop: 4 },
  subscribersFocused: { color: colors.text },
});
