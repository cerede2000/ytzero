import type { ImageURISource } from "react-native";

/**
 * The shape an image source must have for its headers to reach the instance.
 *
 * React Native does not read them from the same place on both platforms. iOS
 * passes the source object through and the native view reads `headers` from it.
 * Android reads them from a separate native prop, which its JavaScript layer
 * fills in from the first entry of the source — and only when the source is an
 * array; a lone object takes the other branch, where `headers` is never carried
 * over. Every thumbnail and avatar is fetched from the instance with a bearer
 * token, so on Android that object silently becomes an unauthenticated request
 * and the picture never arrives.
 *
 * One element in an array is what both platforms read, so it is the only shape
 * this application hands to an image view. `imageSource.test.ts` holds every
 * `<Image>` to it.
 */
export function imageSourceWithHeaders(source: ImageURISource): [ImageURISource] {
  return [source];
}
