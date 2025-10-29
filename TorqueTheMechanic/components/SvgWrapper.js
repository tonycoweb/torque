//SvgWrapper.js
import React, { useRef } from 'react';
import { View, Animated, PanResponder } from 'react-native';
import { SvgXml } from 'react-native-svg';

export default function ZoomableSvg({ xml, height = 240 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  let lastScale = 1, lastX = 0, lastY = 0;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e, g) => {
        if (g.numberActiveTouches === 2 && e.nativeEvent.touches.length === 2) {
          const [a, b] = e.nativeEvent.touches;
          const dx = a.pageX - b.pageX;
          const dy = a.pageY - b.pageY;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          if (!lastScale || !responder.current._baseDist) {
            responder.current._baseDist = dist;
            lastScale = scale.__getValue();
          }
          const newScale = Math.min(4, Math.max(0.6, (dist / responder.current._baseDist) * lastScale));
          scale.setValue(newScale);
        } else if (g.numberActiveTouches === 1) {
          translateX.setValue(lastX + g.dx);
          translateY.setValue(lastY + g.dy);
        }
      },
      onPanResponderRelease: (e, g) => {
        lastX = translateX.__getValue();
        lastY = translateY.__getValue();
        responder.current._baseDist = null;
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  return (
    <View {...responder.panHandlers} style={{ height, overflow: 'hidden' }}>
      <Animated.View style={{ transform: [{ translateX }, { translateY }, { scale }] }}>
        <SvgXml xml={xml} width="100%" height={height} />
      </Animated.View>
    </View>
  );
}
