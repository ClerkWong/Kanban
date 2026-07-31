import Capacitor

@objc(ViewController)
class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureConfigPlugin())
    }
}
