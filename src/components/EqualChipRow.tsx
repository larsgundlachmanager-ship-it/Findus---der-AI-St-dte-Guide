/**
 * Chip-Zeilen: ≤3 Kacheln in einer Zeile (gleich breit),
 * ab 4 Kacheln Wrap in zwei Zeilen.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  count: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function equalChipItemStyle(count: number): ViewStyle {
  if (count > 0 && count <= 3) {
    return { flex: 1, minWidth: 0 };
  }
  return { width: '47%', flexGrow: 1 };
}

export function EqualChipRow({ count, children, style }: Props) {
  const singleRow = count > 0 && count <= 3;
  const itemStyle = equalChipItemStyle(count);
  return (
    <View
      style={[
        styles.row,
        singleRow ? styles.rowSingle : styles.rowWrap,
        style,
      ]}
    >
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<{ style?: StyleProp<ViewStyle> }>(child)) {
          return child;
        }
        return React.cloneElement(child, {
          style: [itemStyle, child.props.style],
        });
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  rowSingle: {
    flexWrap: 'nowrap',
  },
  rowWrap: {
    flexWrap: 'wrap',
  },
});
