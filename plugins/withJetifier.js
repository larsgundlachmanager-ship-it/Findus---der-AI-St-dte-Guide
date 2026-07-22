const { withGradleProperties } = require('expo/config-plugins');

/**
 * Stellt sicher, dass Jetifier aktiv bleibt (AndroidX ↔ Support-Library).
 */
function withJetifier(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const setProp = (key, value) => {
      const existing = props.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    setProp('android.useAndroidX', 'true');
    setProp('android.enableJetifier', 'true');
    setProp(
      'systemProp.javax.xml.parsers.SAXParserFactory',
      'com.sun.org.apache.xerces.internal.jaxp.SAXParserFactoryImpl',
    );
    setProp(
      'systemProp.javax.xml.transform.TransformerFactory',
      'com.sun.org.apache.xalan.internal.xsltc.trax.TransformerFactoryImpl',
    );
    setProp(
      'systemProp.javax.xml.parsers.DocumentBuilderFactory',
      'com.sun.org.apache.xerces.internal.jaxp.DocumentBuilderFactoryImpl',
    );
    return config;
  });
}

module.exports = withJetifier;
