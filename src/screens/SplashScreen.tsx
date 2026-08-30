import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Image, StatusBar } from 'react-native';

let SplashScreenExpo: any = null;
try {
  SplashScreenExpo = require('expo-splash-screen');
} catch (e) {}

const AnimatedText = Animated.createAnimatedComponent(Text);

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  // Animation refs
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoTranslateX = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateX = useRef(new Animated.Value(0)).current;
  const letterSpacing = useRef(new Animated.Value(-6)).current;

  // ADMIN text & symbol shine animation refs
  const adminOpacity = useRef(new Animated.Value(0)).current;
  const shineProgress = useRef(new Animated.Value(0)).current;
  const adminLetterSpacing = useRef(new Animated.Value(2.5)).current;

  useEffect(() => {
    // Hide the native static splash as soon as the animated component is mounted
    if (SplashScreenExpo && typeof SplashScreenExpo.hideAsync === 'function') {
      SplashScreenExpo.hideAsync().catch(() => {});
    }

    // Sequenced grand reveal animation
    Animated.sequence([
      // 1. Logo Fade In at center
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      // 2. Short pause before split reveal
      Animated.delay(250),
      // 3. The Grand Reveal of Logo & AMATORA
      Animated.parallel([
        Animated.timing(logoTranslateX, {
          toValue: -88,
          duration: 950,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateX, {
          toValue: 0,
          duration: 950,
          useNativeDriver: true,
        }),
        Animated.timing(letterSpacing, {
          toValue: 3,
          duration: 950,
          useNativeDriver: false,
        }),
      ]),
      // 4. ADMIN text appears smoothly (mayin paydo bo'lish)
      Animated.timing(adminOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      // 5. ADMIN symbols shine smoothly across letters (ramziy yaltirash, div emas harflarga)
      Animated.parallel([
        // Smooth silver light flash directly on the letter glyphs
        Animated.sequence([
          Animated.timing(shineProgress, {
            toValue: 1,
            duration: 380,
            useNativeDriver: false,
          }),
          Animated.timing(shineProgress, {
            toValue: 0,
            duration: 420,
            useNativeDriver: false,
          }),
        ]),
        // Subtle graceful letter spacing breathing
        Animated.sequence([
          Animated.timing(adminLetterSpacing, {
            toValue: 4.5,
            duration: 380,
            useNativeDriver: false,
          }),
          Animated.timing(adminLetterSpacing, {
            toValue: 2.5,
            duration: 420,
            useNativeDriver: false,
          }),
        ]),
      ]),
    ]).start();

    // Finish splash after ~3.5 seconds
    const timer = setTimeout(() => {
      onFinish();
    }, 3500);

    return () => clearTimeout(timer);
  }, []);

  // Interpolate color directly on ADMIN text symbols (Black -> Bright Silver Shine -> Black)
  const adminTextColor = shineProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['#000000', '#94A3B8'],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={styles.contentWrapper}>
        {/* Large Logo - Starts center, slides left with optimal gap */}
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ translateX: logoTranslateX }],
            },
          ]}
        >
          <Image
            source={require('../../assets/amatora-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Clipping Container for Text Reveal */}
        <View style={styles.clippingContainer}>
          <Animated.View
            style={[
              styles.textContainer,
              {
                opacity: textOpacity,
                transform: [{ translateX: textTranslateX }],
              },
            ]}
          >
            <View style={styles.titleWrapper}>
              <AnimatedText style={[styles.brandName, { letterSpacing: letterSpacing }]}>
                AMATORA
              </AnimatedText>

              {/* ADMIN text with direct letter glyph shine */}
              <Animated.View
                style={[
                  styles.adminBadgeWrapper,
                  {
                    opacity: adminOpacity,
                  },
                ]}
              >
                <AnimatedText
                  style={[
                    styles.adminLabel,
                    {
                      color: adminTextColor,
                      letterSpacing: adminLetterSpacing,
                    },
                  ]}
                >
                  ADMIN
                </AnimatedText>
              </Animated.View>
            </View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
    height: 84,
  },
  logoContainer: {
    width: 78,
    height: 78,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    zIndex: 10,
  },
  logo: {
    width: 72,
    height: 72,
    resizeMode: 'contain',
  },
  clippingContainer: {
    position: 'absolute',
    left: '50%',
    marginLeft: -44,
    width: 280,
    height: 76,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingLeft: 6,
    zIndex: 5,
  },
  textContainer: {
    justifyContent: 'center',
  },
  titleWrapper: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  brandName: {
    color: '#000000',
    fontSize: 28,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  adminBadgeWrapper: {
    position: 'absolute',
    bottom: -11,
    right: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  adminLabel: {
    fontSize: 8.5,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});

export default SplashScreen;
