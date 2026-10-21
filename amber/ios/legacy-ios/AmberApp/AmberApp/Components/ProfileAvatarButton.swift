//
//  ProfileAvatarButton.swift
//  Amber
//
//  Minimal toolbar avatar.
//

import SwiftUI

struct ProfileAvatarButton: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.amberSurface)
                .frame(width: 30, height: 30)
                .overlay(
                    Circle()
                        .strokeBorder(Color.glassStroke, lineWidth: 0.5)
                )

            Text("S")
                .font(.amberCaption)
                .fontWeight(.semibold)
                .foregroundColor(.amberText)
        }
    }
}
