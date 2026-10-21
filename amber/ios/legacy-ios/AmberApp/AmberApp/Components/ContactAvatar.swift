//
//  ContactAvatar.swift
//  Amber
//
//  Uniform material-filled avatar.
//

import SwiftUI

struct ContactAvatar: View {
    let name: String
    let imageURL: String?
    let size: CGFloat

    var body: some View {
        if let url = imageURL, let imageUrl = URL(string: url) {
            AsyncImage(url: imageUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                InitialsAvatar(name: name, size: size)
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
        } else {
            InitialsAvatar(name: name, size: size)
        }
    }
}

struct InitialsAvatar: View {
    let name: String
    let size: CGFloat

    private var initials: String {
        let components = name.components(separatedBy: " ")
        let first = components.first?.prefix(1) ?? ""
        let last = components.count > 1 ? components.last?.prefix(1) ?? "" : ""
        return "\(first)\(last)".uppercased()
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.amberSurface)
            Text(initials)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundColor(.amberText)
        }
        .frame(width: size, height: size)
    }
}
