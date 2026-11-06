import SpriteKit

public enum AtlasLoader {
    public static func texture(named name: String) -> SKTexture? {
        let parts = name.split(separator: "/", maxSplits: 1).map(String.init)
        let path = parts.last ?? name
        let resource = (path as NSString).deletingPathExtension
        let ext = (path as NSString).pathExtension
        let directory = parts.count == 2 ? parts[0] : nil
        guard let url = Bundle.module.url(forResource: resource, withExtension: ext, subdirectory: directory)
            ?? Bundle.module.url(forResource: resource, withExtension: ext)
        else { return nil }
        return SKTexture(imageNamed: url.path)
    }
}
