using System.Windows;
using System.Windows.Controls;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class AdminWindow : Window
{
    private readonly TextBlock status = new()
    {
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 16, 0, 0)
    };

    internal AdminWindow()
    {
        Title = "CEP Horas — recuperação administrativa";
        Width = 640;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var panel = new StackPanel { Margin = new Thickness(28) };
        Content = panel;
        panel.Children.Add(new TextBlock
        {
            Text = "Controle local de energia",
            FontSize = 24,
            FontWeight = FontWeights.SemiBold
        });
        panel.Children.Add(new TextBlock
        {
            Margin = new Thickness(0, 16, 0, 16),
            TextWrapping = TextWrapping.Wrap,
            Text = "O instalador ativa automaticamente as restrições para usuários comuns. O CEP Horas consulta a API e o serviço local executa Desligar, Reiniciar ou Hibernar. Sem resposta da API, a contingência local permite a ação.\n\nEsta ferramenta é exclusiva da TI e restaura as permissões e políticas existentes antes da instalação. Administradores e SYSTEM permanecem como recuperação. Faça novo logon depois de aplicar ou restaurar políticas."
        });
        var verify = new Button
        {
            Content = "Verificar serviço e política",
            Padding = new Thickness(12, 9, 12, 9)
        };
        verify.Click += async (_, _) =>
        {
            try
            {
                var service = await ControlClient.Send(new ControlRequest("status"));
                status.Text = service.Message;
            }
            catch (Exception error) { status.Text = "Falha na verificação: " + error.Message; }
        };
        panel.Children.Add(verify);
        var restore = new Button
        {
            Content = "Restaurar configurações anteriores (TI)",
            Padding = new Thickness(12, 9, 12, 9),
            Margin = new Thickness(0, 10, 0, 0)
        };
        restore.Click += (_, _) =>
        {
            if (MessageBox.Show(
                    "Restaurar as permissões e configurações de energia salvas antes da instalação?",
                    Title,
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            try
            {
                PolicyStore.Restore();
                status.Text = "Configurações restauradas. Faça novo logon dos usuários.";
            }
            catch (Exception error)
            {
                status.Text = "A restauração não concluiu. Preserve a instalação e o backup: " + error.Message;
            }
        };
        panel.Children.Add(restore);
        panel.Children.Add(status);
    }
}
