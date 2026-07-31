import Capacitor
import Foundation
import Security

@objc(SecureConfigPlugin)
public class SecureConfigPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureConfigPlugin"
    public let jsName = "SecureConfig"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.wongchambers.kanban.sync-config.v1"
    private let account = "default"

    private var baseQuery: [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecAttrSynchronizable: false
        ]
    }

    @objc func load(_ call: CAPPluginCall) {
        var query = baseQuery
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve()
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject(
                "無法讀取安全同步憑證。",
                "secure_config_read_failed"
            )
            return
        }
        call.resolve(["value": value])
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let value = call.getString("value"),
              let data = value.data(using: .utf8) else {
            call.reject("缺少同步憑證內容。", "secure_config_value_required")
            return
        }
        let updateStatus = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData: data] as CFDictionary
        )
        if updateStatus == errSecSuccess {
            call.resolve()
            return
        }
        guard updateStatus == errSecItemNotFound else {
            call.reject(
                "無法保存安全同步憑證。",
                "secure_config_write_failed"
            )
            return
        }
        var item = baseQuery
        item[kSecValueData] = data
        item[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            call.reject(
                "無法保存安全同步憑證。",
                "secure_config_write_failed"
            )
            return
        }
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject(
                "無法清除安全同步憑證。",
                "secure_config_clear_failed"
            )
            return
        }
        call.resolve()
    }
}
